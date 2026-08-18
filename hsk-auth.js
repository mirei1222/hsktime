/* ============================================================
 * HSK_time — 로그인 / 구독 관리 모듈
 * ------------------------------------------------------------
 * 사용법: index.html 안에 아래처럼 넣으세요.
 *
 *   <script type="module" src="./hsk-auth.js"></script>
 *
 * 기존 <script>(일반 스크립트)에서는 window.HSKAuth 로 접근합니다.
 * ============================================================ */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ------------------------------------------------------------
 * 1. 설정 — Supabase 대시보드 > Project Settings > API 에서 복사
 *
 *    ⚠️ 아래 두 값이 잘못 들어가 있었어요! 반드시 실제 값으로 교체하세요.
 *    - SUPABASE_URL: "https://xxxxxxxxxxx.supabase.co" 형태 (Project URL)
 *    - SUPABASE_ANON_KEY: "eyJ..."로 시작하는 긴 문자열 (anon public key)
 *
 *    anon key는 공개돼도 괜찮은 키예요. RLS가 실제 방어선이라
 *    이 키만으로는 남의 데이터를 읽거나 구독을 늘릴 수 없어요.
 *    (service_role 키는 절대 여기 넣으면 안 돼요!)
 * ---------------------------------------------------------- */
const SUPABASE_URL = "https://abskpzeitstjuxqgqvrp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFic2twemVpdHN0anV4cWdxdnJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMzIwNTAsImV4cCI6MjEwMTYwODA1MH0.-ddEtuHY9o5uu-FuzA1DauI0hhVmM8ycQTl_wb1sUHQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,      // 새로고침해도 로그인 유지
    autoRefreshToken: true,    // 토큰 자동 갱신
    detectSessionInUrl: true,  // 구글 로그인 후 리다이렉트 처리
  },
});

/* ------------------------------------------------------------
 * 2. 현재 상태 (다른 코드에서 읽어 쓰는 값)
 * ---------------------------------------------------------- */
const state = {
  user: null,           // { id, email } 또는 null
  isSubscribed: false,  // 구독 유효 여부
  expiresAt: null,      // Date 또는 null
};

const listeners = new Set();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn({ ...state });
    } catch (e) {
      console.error("[HSKAuth] 리스너 오류:", e);
    }
  });
}

/* ------------------------------------------------------------
 * 3. 로그인 / 로그아웃
 * ---------------------------------------------------------- */

/** 구글 간편 로그인 */
async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      // 로그인 후 돌아올 주소 (Supabase 대시보드에도 등록 필요)
      redirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true }; // 이 시점에 페이지가 구글로 이동해요
}

/** 이메일 회원가입 */
async function signUpWithEmail(email, password) {
  if (!email || !password) {
    return { ok: false, reason: "이메일과 비밀번호를 입력해 주세요" };
  }
  if (password.length < 6) {
    return { ok: false, reason: "비밀번호는 6자 이상이어야 해요" };
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { ok: false, reason: translateAuthError(error.message) };

  // 이메일 인증을 켜둔 경우 session이 아직 없어요
  if (!data.session) {
    return {
      ok: true,
      needsEmailConfirm: true,
      message: "가입 확인 메일을 보냈어요. 메일함을 확인해 주세요.",
    };
  }
  return { ok: true, needsEmailConfirm: false };
}

/** 이메일 로그인 */
async function signInWithEmail(email, password) {
  if (!email || !password) {
    return { ok: false, reason: "이메일과 비밀번호를 입력해 주세요" };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, reason: translateAuthError(error.message) };
  return { ok: true };
}

/** 비밀번호 재설정 메일 */
async function sendPasswordReset(email) {
  if (!email) return { ok: false, reason: "이메일을 입력해 주세요" };
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) return { ok: false, reason: translateAuthError(error.message) };
  return { ok: true, message: "비밀번호 재설정 메일을 보냈어요." };
}

/** 로그아웃 */
async function signOut() {
  await supabase.auth.signOut();
  state.user = null;
  state.isSubscribed = false;
  state.expiresAt = null;
  notify();
  return { ok: true };
}

/* ------------------------------------------------------------
 * 4. 구독 상태 조회 / 코드 등록
 * ---------------------------------------------------------- */

/** 서버에서 내 구독 상태를 다시 읽어옵니다 */
async function refreshSubscription() {
  if (!state.user) {
    state.isSubscribed = false;
    state.expiresAt = null;
    notify();
    return { active: false };
  }

  const { data, error } = await supabase.rpc("my_subscription");

  if (error) {
    console.error("[HSKAuth] 구독 조회 실패:", error);
    // 네트워크 오류 시엔 기존 상태를 함부로 지우지 않아요
    return { active: state.isSubscribed, error: error.message };
  }

  state.isSubscribed = !!data?.active;
  state.expiresAt = data?.expires_at ? new Date(data.expires_at) : null;
  notify();
  return { active: state.isSubscribed, expiresAt: state.expiresAt };
}

/**
 * 구독 코드 등록
 * 실제 검증은 전부 서버(Postgres 함수)에서 이뤄져요.
 * 브라우저 콘솔을 조작해도 코드를 만들어낼 수 없어요.
 */
async function redeemCode(code) {
  if (!state.user) {
    return { ok: false, reason: "로그인 후 이용해 주세요" };
  }

  const { data, error } = await supabase.rpc("redeem_code", {
    p_code: String(code || "").trim(),
  });

  if (error) {
    console.error("[HSKAuth] 코드 등록 실패:", error);
    return { ok: false, reason: "일시적인 오류예요. 잠시 후 다시 시도해 주세요." };
  }

  if (data?.ok) {
    await refreshSubscription();
    return {
      ok: true,
      expiresAt: new Date(data.expires_at),
      days: data.days,
    };
  }

  return { ok: false, reason: data?.reason || "코드를 확인해 주세요" };
}

/* ------------------------------------------------------------
 * 4.5 학습기록 동기화 (누적 학습단어 / 연속학습일 / 오답노트 / 미리보기)
 *     — 기기를 바꿔도 로그인하면 이어지도록
 * ---------------------------------------------------------- */

/** 클라우드에 저장된 내 학습기록을 가져옴. 아직 없으면 null */
async function syncPull() {
  if (!state.user) return null;

  const { data, error } = await supabase
    .from("user_learning_data")
    .select("studied_all, study_dates, wrong_words, preview_seen")
    .eq("user_id", state.user.id)
    .maybeSingle();

  if (error) {
    console.warn("[HSKAuth] syncPull 오류:", error);
    return null;
  }
  return data;
}

/** 로컬에서 병합한 학습기록을 클라우드에 저장(upsert) */
async function syncPush(payload) {
  if (!state.user) return;

  const { error } = await supabase
    .from("user_learning_data")
    .upsert({
      user_id: state.user.id,
      studied_all: payload.studied_all,
      study_dates: payload.study_dates,
      wrong_words: payload.wrong_words,
      preview_seen: payload.preview_seen,
      updated_at: new Date().toISOString(),
    });

  if (error) console.warn("[HSKAuth] syncPush 오류:", error);
}

/* ------------------------------------------------------------
 * 5. 세션 감지 (새로고침·기기변경·쿠키삭제 후에도 복구)
 * ---------------------------------------------------------- */
supabase.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    state.user = { id: session.user.id, email: session.user.email };
    await refreshSubscription();
  } else {
    state.user = null;
    state.isSubscribed = false;
    state.expiresAt = null;
    notify();
  }
});

// 페이지 첫 로드 시 기존 세션 복구
(async function init() {
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    state.user = {
      id: data.session.user.id,
      email: data.session.user.email,
    };
    await refreshSubscription();
  } else {
    notify();
  }
})();

/* ------------------------------------------------------------
 * 6. 유틸
 * ---------------------------------------------------------- */
function translateAuthError(msg) {
  const m = String(msg || "");
  if (m.includes("Invalid login credentials")) return "이메일 또는 비밀번호가 맞지 않아요";
  if (m.includes("User already registered")) return "이미 가입된 이메일이에요";
  if (m.includes("Email not confirmed")) return "메일함에서 가입 확인을 먼저 해주세요";
  if (m.includes("rate limit") || m.includes("Too many")) return "요청이 많아요. 잠시 후 다시 시도해 주세요";
  if (m.includes("Password should be")) return "비밀번호는 6자 이상이어야 해요";
  return "로그인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요";
}

/** 남은 일수 (구독 중이 아니면 0) */
function daysLeft() {
  if (!state.isSubscribed || !state.expiresAt) return 0;
  const ms = state.expiresAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

/** 상태가 바뀔 때마다 호출될 콜백 등록 → 해제 함수 반환 */
function onChange(fn) {
  listeners.add(fn);
  fn({ ...state }); // 등록 즉시 현재 상태 1회 전달
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------------
 * 7. 외부 공개 (일반 <script>에서도 쓸 수 있게 window에 붙임)
 * ---------------------------------------------------------- */
const HSKAuth = {
  // 로그인
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
  sendPasswordReset,
  signOut,
  // 구독
  refreshSubscription,
  redeemCode,
  daysLeft,
  // 학습기록 동기화
  syncPull,
  syncPush,
  // 상태
  onChange,
  get user() { return state.user; },
  get isSubscribed() { return state.isSubscribed; },
  get expiresAt() { return state.expiresAt; },
  // 필요하면 직접 쓸 수 있게
  supabase,
};

window.HSKAuth = HSKAuth;
export default HSKAuth;
