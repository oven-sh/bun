//! libuv backend (Windows): one uv_poll per armed socket (owned via
//! `SocketHeader.uv_p`), uv_prepare/uv_check driving loop_pre/loop_post
//! around each uv_run iteration, us_timer_t, and active-handle proxying into
//! `uv_loop.active_handles`. Implements core-semantics.md §1-2 (libuv arm) +
//! consumers/10-event-loop.md §5.
//! All uv unsafety lives in `unsafe_core::ffi::uv`; this file is safe glue.

use core::ffi::c_void;

use crate::backend::{Events, PollState};
use crate::loop_::{Loop, WakeupAsync};
use crate::socket::us_socket_t;
use crate::unsafe_core::ffi::uv;
use crate::unsafe_core::poll_access;

// ── loop lifecycle (libuv.c:154-212) ─────────────────────────────────────────
// The loop shard's `create_loop_raw`/`free_loop_raw` windows arms call these
// around loop-data init/free, mirroring the C order.

/// `us_create_loop` libuv head (libuv.c:162-175): adopt `hint` when given
/// (Bun binds the uws loop to the thread's default libuv loop) else own a
/// fresh `uv_loop_new()`, then start the unreffed prepare/check hooks.
/// Fills `WindowsLoop.{uv_loop,is_default,pre,check}`. −1 on loop-create
/// failure (nothing to unwind).
pub(crate) fn loop_init(loop_: *mut Loop, hint: *mut c_void) -> i32 {
    uv::loop_init(loop_, hint)
}

/// `us_loop_free` head (libuv.c:191-199). The caller frees loop data
/// (timers/async close) between this and [`loop_teardown`].
pub(crate) fn loop_close_hooks(loop_: *mut Loop) {
    uv::loop_close_hooks(loop_);
}

/// `us_loop_free` tail (libuv.c:203-208): owned loops get one last NOWAIT
/// run to fire close callbacks, then deletion; default (hint) loops don't.
pub(crate) fn loop_teardown(loop_: *mut Loop) {
    uv::loop_teardown(loop_);
}

/// `us_loop_run` (libuv.c:214-219). Callers hold only `*mut Loop` — uv_run
/// dispatches back into Rust, so no `&mut Loop` may span this call (C17).
pub(crate) fn run(loop_: *mut Loop) {
    uv::loop_run_once(loop_);
}

/// `us_loop_pump` (libuv.c:150-152).
pub(crate) fn pump(loop_: *mut Loop) {
    uv::loop_pump(loop_);
}

// ── socket poll arm/stop (libuv.c:93-133) ────────────────────────────────────
// The uv_poll wrapper is created at first arm and owned by `s.uv_p` until
// `socket_poll_stop`; its box dies later in the uv_close callback (deferred
// free, R2.4).

/// `us_poll_start` (libuv.c:93-105): polling bits, init_socket + always-unref
/// (keep-alive is Bun's `Async.KeepAlive`, not usockets), start. Always
/// returns 0 (R2.13); on uv_poll_init_socket failure the socket is left
/// unarmed with the polling bits clear (C ignores the rc and proceeds into
/// UB — we surface it in debug and keep R2.6's believed set truthful).
pub(crate) fn socket_poll_start(s: *mut us_socket_t, loop_: *mut Loop, events: Events) -> i32 {
    if uv::socket_poll_is_armed(s) {
        // Already-armed re-start = uv_poll_start with the new set (the C
        // path re-inits the live handle; the restart is the effective part).
        set_polling_bits(s, events);
        uv::socket_poll_rearm(s, events);
        return 0;
    }
    let armed = uv::socket_poll_first_arm(loop_, s, events);
    debug_assert!(armed, "uv_poll_init_socket failed; socket will never fire");
    if armed {
        set_polling_bits(s, events);
    }
    0
}

/// `us_poll_change` (libuv.c:112-121): no-op when `uv_p` is null (never
/// armed / already stopped) or the believed event set is unchanged.
pub(crate) fn socket_poll_change(s: *mut us_socket_t, _loop: *mut Loop, events: Events) {
    if !uv::socket_poll_is_armed(s) {
        return;
    }
    if poll_access::read_poll(s.cast::<PollState>()).events() != events {
        set_polling_bits(s, events);
        uv::socket_poll_rearm(s, events);
    }
}

/// `us_poll_stop` + deferred free (libuv.c:123-133): stop, null `uv_p`, then
/// uv_close; the wrapper is freed by its close callback, never here.
/// Tolerates never-armed/already-stopped sockets.
pub(crate) fn socket_poll_stop(s: *mut us_socket_t, _loop: *mut Loop) {
    uv::socket_poll_stop_close(s);
}

/// The PollState polling bits are the believed registration (R2.6) — the
/// dispatch-time source of truth, same as the POSIX backends.
fn set_polling_bits(s: *mut us_socket_t, events: Events) {
    let p = s.cast::<PollState>();
    let mut st = poll_access::read_poll(p);
    st.set_polling(events);
    poll_access::write_poll(p, st);
}

// ── active-handle proxying (consumers/10-event-loop.md §5) ───────────────────
// WindowsLoop keep-alive accounting goes into `uv_loop.active_handles` (a
// Bun-private counter libuv reads in `uv__loop_alive`), not `num_polls`.

pub(crate) fn add_active(loop_: *mut Loop, value: u32) {
    uv::add_active(loop_, value);
}

pub(crate) fn sub_active(loop_: *mut Loop, value: u32) {
    uv::sub_active(loop_, value);
}

pub(crate) fn inc_active(loop_: *mut Loop) {
    uv::add_active(loop_, 1);
}

pub(crate) fn dec_active(loop_: *mut Loop) {
    uv::sub_active(loop_, 1);
}

pub(crate) fn unref_count(loop_: *mut Loop, count: i32) {
    uv::unref_count_active(loop_, count);
}

pub(crate) fn is_active(loop_: *mut Loop) -> bool {
    uv::loop_alive(loop_)
}

pub(crate) fn active_count(loop_: *mut Loop) -> u32 {
    uv::active_count(loop_)
}

// ── wakeup async (R10.4 libuv arm) ───────────────────────────────────────────

/// uv_async, unreffed; `cb` receives the LOOP pointer (`cb_expects_the_loop`).
pub(crate) fn create_wakeup_async(
    loop_: *mut Loop,
    cb: unsafe extern "C" fn(*mut Loop),
) -> *mut WakeupAsync {
    uv::wakeup_async_create(loop_, cb)
}

/// `us_wakeup_loop` libuv arm: just uv_async_send, callable from any thread —
/// no `pending_wakeups` consumption on this backend (R10.1).
pub(crate) fn wakeup_async_send(a: *mut WakeupAsync) {
    uv::wakeup_async_send(a);
}

pub(crate) fn wakeup_async_close(a: *mut WakeupAsync) {
    uv::wakeup_async_close(a);
}

// ── us_timer_t (libuv only — POSIX has no us_timer users left) ───────────────

/// Opaque: a `us_internal_callback_t` header + embedded uv_timer_t + ext in
/// one allocation (`ffi::uv::TimerBlob`). Freed only by its uv_close callback.
pub struct Timer {
    _opaque: [u8; 0],
}

impl Timer {
    /// `us_create_timer`; `fallthrough` = unreffed (does not keep loop alive).
    pub fn create(loop_: *mut Loop, fallthrough: bool, ext_size: usize) -> *mut Timer {
        uv::timer_create(loop_, fallthrough, ext_size)
    }

    /// `us_timer_set`: `ms == 0` → stop; sweep timer is one-shot-guarded so
    /// repeated enable_sweep calls don't skew the 4 s cadence (OQ-16).
    pub fn set(
        t: *mut Timer,
        cb: Option<unsafe extern "C" fn(*mut Timer)>,
        ms: i32,
        repeat_ms: i32,
    ) {
        uv::timer_set(t, cb, ms, repeat_ms);
    }

    /// `us_timer_close`: always refs, stops, then defer-frees via uv_close.
    pub fn close(t: *mut Timer) {
        uv::timer_close(t);
    }

    /// `us_timer_loop`.
    pub(crate) fn owner_loop(t: *mut Timer) -> *mut Loop {
        uv::timer_loop(t)
    }

    /// `us_timer_ext`.
    pub(crate) fn ext(t: *mut Timer) -> *mut c_void {
        uv::timer_ext(t)
    }
}

/// Sweep driver: on libuv the 4 s sweep is the repeating uv timer's callback,
/// not a poll-deadline fold (R5.8 libuv arm, loop.c:386-389).
pub(crate) extern "C" fn sweep_timer_cb(t: *mut Timer) {
    crate::loop_::timeouts::timer_sweep(Timer::owner_loop(t));
}
