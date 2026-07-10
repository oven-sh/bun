//! `bun_iocp` — Bun's native Windows event loop (the libuv replacement).
//!
//! An IOCP-based completion loop plus the handle classes built on it. Design
//! contracts are tracked in `src/sys/windows/quirks/` (`// quirk: <ID>`
//! annotations reference ledger entries); the uSockets eventing surface this
//! crate exports is specified in `USOCKETS_EVENTING_CONTRACT.md`.
//!
//! Error policy: this crate traffics in raw `Win32Error`/`NTSTATUS` and never
//! produces an errno — consumers translate exactly once at their boundary
//! via `bun_sys::windows::win_error`. // quirk: SOCK-58

pub mod afd;
pub(crate) mod dispatch;
pub mod event_loop;
pub mod fsevent;
pub mod handle;
pub mod init;
pub mod pipe;
pub mod process;
pub mod req;
pub mod signal;
pub mod timer;
pub mod tty;
pub mod usockets;

#[cfg(windows)]
pub use afd::{AfdPoll, POLL_DISCONNECT, POLL_READABLE, POLL_WRITABLE, PollCb, PollCloseCb};
#[cfg(windows)]
pub use event_loop::{HookFn, Loop, TickResult};
#[cfg(windows)]
pub use fsevent::{
    FS_EVENT_CHANGE, FS_EVENT_RENAME, FS_EVENT_RESCAN, FsEventCb, FsEventCloseCb, FsEventHandle,
};
#[cfg(windows)]
pub use handle::{EndgameFn, HandleCore};
#[cfg(windows)]
pub use init::{ensure_winsock, process_init, wake_all_loops};
#[cfg(windows)]
pub use pipe::{
    PairOptions, PipeCloseCb, PipeConnectCb, PipeConnectionCb, PipeHandle, PipeReadCb,
    PipeShutdownCb, PipeWriteCb, create_pair,
};
#[cfg(windows)]
pub use process::{
    KillError, PROCESS_DETACHED, PROCESS_FILE_PATH_EXACT_NAME, PROCESS_HIDE, PROCESS_HIDE_CONSOLE,
    PROCESS_HIDE_GUI, PROCESS_VERBATIM_ARGUMENTS, ProcessCloseCb, ProcessExitCb, ProcessHandle,
    ProcessOptions, SIGINT, SIGKILL, SIGQUIT, SIGTERM, Stdio, disable_stdio_inheritance, kill_pid,
};
#[cfg(windows)]
pub use req::{Req, ReqKind};
#[cfg(windows)]
pub use signal::{
    SIGBREAK, SIGHUP, SIGWINCH, SignalCb, SignalCloseCb, SignalHandle, dispatch_signal,
};
#[cfg(windows)]
pub use timer::{Timer, TimerCb};
#[cfg(windows)]
pub use tty::{
    TtyCloseCb, TtyHandle, TtyMode, TtyReadCb, TtyReadData, TtyResizeCb, TtyShutdownCb, TtyWriteCb,
};

/// Shared by the test modules of `lib.rs` and `afd.rs`: timing-sensitive
/// tests and tests that post to the global loop registry (or create real
/// sockets) must not overlap — a stray `wake_all_loops` ends another test's
/// wait early, and a recycled SOCKET value could land in another test's
/// watcher.
#[cfg(all(test, windows))]
pub(crate) mod test_sync {
    use std::sync::{Mutex, MutexGuard};

    static SERIAL: Mutex<()> = Mutex::new(());
    pub(crate) fn serial() -> MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|p| p.into_inner())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use core::ptr;

    use super::*;
    use crate::test_sync::serial;

    /// End-to-end against a real port: wakeups coalesce, NULL packets are
    /// filtered, and a self-posted request dispatches with its recorded
    /// error. // quirk: LOOP-03, POLL-28
    #[test]
    fn port_wakeup_null_filter_and_pending_dispatch() {
        let _guard = serial();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &mut *loop_;

        // Two wakes coalesce into one packet.
        unsafe {
            Loop::wake(lp);
            Loop::wake(lp);
        }
        assert!(loop_.wakeup_in_flight());
        // A foreign NULL packet also ends the wait and is ignored.
        let ok = unsafe {
            bun_windows_sys::kernel32::PostQueuedCompletionStatus(
                loop_.iocp(),
                0,
                0,
                ptr::null_mut(),
            )
        };
        assert!(ok != 0);

        // Wakeup and NULL packets are consumed internally, not dispatched.
        let n = loop_.poll_once(Some(1000));
        assert_eq!(n, 0);
        assert!(!loop_.wakeup_in_flight());

        // After consumption, a new wake posts a fresh packet.
        unsafe { Loop::wake(lp) };
        assert!(loop_.wakeup_in_flight());
        loop_.poll_once(Some(1000));
        assert!(!loop_.wakeup_in_flight());

        // Synchronous-failure funnel: a locally-failed request travels the
        // pending queue carrying a kernel-shaped status; its recorded error
        // is intact after dispatch (the owner reads it from the req).
        let mut req = Box::new(Req::new(ReqKind::Wakeup, ptr::null_mut()));
        req.set_error(bun_windows_sys::Win32Error::WSAENOTSOCK);
        unsafe { loop_.insert_pending(&mut *req) };
        assert!(loop_.has_pending());
        let drained = loop_.process_pending();
        assert_eq!(drained, 1);
        assert!(!loop_.has_pending());
        assert!(!req.success());
        assert_eq!(req.error(), bun_windows_sys::Win32Error::WSAENOTSOCK);
    }

    /// The wait must never return before its deadline (the early-return
    /// re-arm), and timers built on it can therefore never fire early.
    /// // quirk: LOOP-02
    #[test]
    fn poll_never_returns_early() {
        let _guard = serial();
        let mut loop_ = Loop::new().unwrap();
        for timeout in [1u64, 5, 15, 16, 31, 50] {
            let start = loop_.now_ms();
            let n = loop_.poll_once(Some(timeout));
            let elapsed = loop_.now_ms() - start;
            assert_eq!(n, 0);
            assert!(
                elapsed >= timeout,
                "poll_once({timeout}) returned after {elapsed}ms"
            );
        }
    }

    /// Pending queue is FIFO and drains fully per round; head/tail stay
    /// consistent across drain/insert cycles. (Re-entrant insertion lands in
    /// the next snapshot — exercised through the first handle class whose
    /// dispatch arm runs user code.)
    #[test]
    fn pending_fifo_drain() {
        let mut loop_ = Loop::new().unwrap();
        let mut a = Box::new(Req::new(ReqKind::Wakeup, ptr::null_mut()));
        let mut b = Box::new(Req::new(ReqKind::Wakeup, ptr::null_mut()));
        let mut c = Box::new(Req::new(ReqKind::Wakeup, ptr::null_mut()));
        unsafe {
            loop_.insert_pending(&mut *a);
            loop_.insert_pending(&mut *b);
        }
        assert_eq!(loop_.process_pending(), 2);
        assert!(!loop_.has_pending());
        unsafe { loop_.insert_pending(&mut *c) };
        assert_eq!(loop_.process_pending(), 1);
        assert!(!loop_.has_pending());
        assert_eq!(loop_.process_pending(), 0);
    }

    /// Timer semantics through the loop API: FIFO tiebreak for equal
    /// deadlines, stop() tombstoning, and a repeating callback stopping its
    /// own timer via the re-lent loop.
    #[test]
    fn timer_semantics() {
        struct Ctx {
            order: Vec<u32>,
            self_stop: Timer,
            fires: u32,
        }
        unsafe fn push1(_l: &mut Loop, d: *mut core::ffi::c_void) {
            unsafe { (*d.cast::<Ctx>()).order.push(1) };
        }
        unsafe fn push2(_l: &mut Loop, d: *mut core::ffi::c_void) {
            unsafe { (*d.cast::<Ctx>()).order.push(2) };
        }
        unsafe fn push3(_l: &mut Loop, d: *mut core::ffi::c_void) {
            unsafe { (*d.cast::<Ctx>()).order.push(3) };
        }
        unsafe fn self_stopper(l: &mut Loop, d: *mut core::ffi::c_void) {
            unsafe {
                let ctx = &mut *d.cast::<Ctx>();
                ctx.fires += 1;
                if ctx.fires == 2 {
                    let mut t = core::mem::take(&mut ctx.self_stop);
                    l.timer_stop(&mut t);
                    ctx.self_stop = t;
                }
            }
        }

        let mut loop_ = Loop::new().unwrap();
        let mut ctx = Ctx {
            order: Vec::new(),
            self_stop: Timer::new(),
            fires: 0,
        };
        let d: *mut core::ffi::c_void = (&raw mut ctx).cast();

        let mut t1 = Timer::new();
        let mut t2 = Timer::new();
        let mut t3 = Timer::new();
        loop_.timer_start(&mut t1, push1, d, 0, 0);
        loop_.timer_start(&mut t2, push2, d, 0, 0);
        loop_.timer_start(&mut t3, push3, d, 0, 0);
        loop_.timer_stop(&mut t2);
        assert_eq!(loop_.run_timers(), 2);
        assert_eq!(ctx.order, vec![1, 3]);
        assert!(!loop_.timer_armed(&t1), "one-shot disarmed itself");

        let mut t = Timer::new();
        loop_.timer_start(&mut t, self_stopper, d, 0, 1);
        ctx.self_stop = t;
        let deadline = loop_.now_ms() + 1000;
        while ctx.fires < 2 && loop_.now_ms() < deadline {
            loop_.run_timers();
        }
        assert_eq!(ctx.fires, 2);
        assert!(!loop_.timer_armed(&ctx.self_stop));
        let until = loop_.now_ms() + 10;
        while loop_.now_ms() < until {
            assert_eq!(loop_.run_timers(), 0);
        }
        let mut t = core::mem::take(&mut ctx.self_stop);
        loop_.timer_release(&mut t);
    }

    /// One full tick: hook order (pre → before-wait → post), the timer
    /// deadline folded into the wait, the timer firing inside the bracket,
    /// never early. // quirk: LOOP-28, LOOP-02
    #[test]
    fn tick_orchestration_and_hook_order() {
        let _guard = serial();
        struct Ctx {
            events: Vec<&'static str>,
        }
        unsafe fn pre(_l: &mut Loop, d: *mut core::ffi::c_void) {
            unsafe { (*d.cast::<Ctx>()).events.push("pre") };
        }
        unsafe fn post(_l: &mut Loop, d: *mut core::ffi::c_void) {
            unsafe { (*d.cast::<Ctx>()).events.push("post") };
        }
        unsafe fn before_wait(_l: &mut Loop, d: *mut core::ffi::c_void) {
            unsafe { (*d.cast::<Ctx>()).events.push("before_wait") };
        }
        unsafe fn timer_cb(_l: &mut Loop, d: *mut core::ffi::c_void) {
            unsafe { (*d.cast::<Ctx>()).events.push("timer") };
        }

        let mut loop_ = Loop::new().unwrap();
        let mut ctx = Ctx { events: Vec::new() };
        let d: *mut core::ffi::c_void = (&raw mut ctx).cast();
        loop_.set_pre_hook(Some((pre, d)));
        loop_.set_post_hook(Some((post, d)));
        loop_.set_before_wait_hook(Some((before_wait, d)));

        let mut t = Timer::new();
        loop_.timer_start(&mut t, timer_cb, d, 30, 0);

        let start = loop_.now_ms();
        let result = loop_.tick(None);
        let elapsed = loop_.now_ms() - start;
        assert_eq!(result.timers_fired, 1);
        assert!(!result.stopped);
        assert!(elapsed >= 30, "timer fired early: {elapsed}ms");
        assert_eq!(ctx.events, vec!["pre", "before_wait", "timer", "post"]);

        // Non-blocking tick skips the before-wait hook.
        ctx.events.clear();
        loop_.tick(Some(0));
        assert_eq!(ctx.events, vec!["pre", "post"]);
    }

    /// A zero-timeout timer restarted from its own callback fires exactly
    /// once per drain — the two-phase collect prevents the busy-loop while
    /// the millisecond clock stands still. // quirk: LOOP-44
    #[test]
    fn zero_timeout_restart_does_not_busy_loop() {
        struct Ctx {
            fires: u32,
            timer: Timer,
        }
        unsafe fn restarter(l: &mut Loop, d: *mut core::ffi::c_void) {
            unsafe {
                let ctx = &mut *d.cast::<Ctx>();
                ctx.fires += 1;
                let mut t = core::mem::take(&mut ctx.timer);
                l.timer_start(&mut t, restarter, d, 0, 0);
                ctx.timer = t;
            }
        }
        let mut loop_ = Loop::new().unwrap();
        let mut ctx = Ctx {
            fires: 0,
            timer: Timer::new(),
        };
        let d: *mut core::ffi::c_void = (&raw mut ctx).cast();
        let mut t = Timer::new();
        loop_.timer_start(&mut t, restarter, d, 0, 0);
        ctx.timer = t;
        for round in 1..=3u32 {
            assert_eq!(loop_.run_timers(), 1, "round {round}");
            assert_eq!(ctx.fires, round);
        }
        let mut t = core::mem::take(&mut ctx.timer);
        loop_.timer_release(&mut t);
    }

    /// A callback stopping a sibling timer that was collected in the same
    /// due batch prevents the sibling from firing. // quirk: LOOP-44
    #[test]
    fn stop_during_batch_prevents_collected_fire() {
        struct Ctx {
            order: Vec<u32>,
            victim: Timer,
        }
        unsafe fn killer(l: &mut Loop, d: *mut core::ffi::c_void) {
            unsafe {
                let ctx = &mut *d.cast::<Ctx>();
                ctx.order.push(1);
                let mut v = core::mem::take(&mut ctx.victim);
                l.timer_stop(&mut v);
                ctx.victim = v;
            }
        }
        unsafe fn victim_cb(_l: &mut Loop, d: *mut core::ffi::c_void) {
            unsafe { (*d.cast::<Ctx>()).order.push(2) };
        }
        let mut loop_ = Loop::new().unwrap();
        let mut ctx = Ctx {
            order: Vec::new(),
            victim: Timer::new(),
        };
        let d: *mut core::ffi::c_void = (&raw mut ctx).cast();
        let mut t1 = Timer::new();
        let mut t2 = Timer::new();
        loop_.timer_start(&mut t1, killer, d, 0, 0);
        loop_.timer_start(&mut t2, victim_cb, d, 0, 0);
        ctx.victim = t2;
        assert_eq!(loop_.run_timers(), 1);
        assert_eq!(ctx.order, vec![1], "stopped sibling must not fire");
        assert_eq!(loop_.run_timers(), 0);
    }

    /// stop() from a hook forces a prompt, non-blocking return with the flag
    /// consumed exactly once.
    #[test]
    fn stop_breaks_the_tick() {
        let _guard = serial();
        unsafe fn stopping_pre(l: &mut Loop, _d: *mut core::ffi::c_void) {
            l.stop();
        }
        let mut loop_ = Loop::new().unwrap();
        loop_.set_pre_hook(Some((stopping_pre, core::ptr::null_mut())));
        let start = loop_.now_ms();
        let result = loop_.tick(Some(5_000));
        assert!(result.stopped);
        assert!(
            loop_.now_ms() - start < 4_000,
            "stop did not break the wait"
        );
        loop_.set_pre_hook(None);
        let result2 = loop_.tick(Some(0));
        assert!(!result2.stopped);
    }

    /// The endgame protocol: close is deferred behind reqs_pending, queued
    /// exactly once, drains LIFO and to exhaustion (cascades run in the same
    /// phase), and a closing handle keeps the loop alive even when unref'd.
    /// // quirk: LOOP-25, LOOP-26, LOOP-27
    #[test]
    fn endgame_protocol() {
        struct TestHandle {
            core: HandleCore,
            closed_order: *mut Vec<u8>,
            id: u8,
            cascade: *mut TestHandle,
        }
        unsafe fn endgame(core: *mut HandleCore) {
            unsafe {
                let h = core.cast::<TestHandle>();
                (*(*h).closed_order).push((*h).id);
                let cascade = (*h).cascade;
                if !cascade.is_null() {
                    (*cascade).core.close();
                }
            }
        }

        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &mut *loop_;
        let mut order: Vec<u8> = Vec::new();

        let mut h3 = Box::new(TestHandle {
            core: unsafe { HandleCore::new(lp, endgame) },
            closed_order: &raw mut order,
            id: 3,
            cascade: ptr::null_mut(),
        });
        let mut h1 = Box::new(TestHandle {
            core: unsafe { HandleCore::new(lp, endgame) },
            closed_order: &raw mut order,
            id: 1,
            cascade: &raw mut *h3,
        });
        let mut h2 = Box::new(TestHandle {
            core: unsafe { HandleCore::new(lp, endgame) },
            closed_order: &raw mut order,
            id: 2,
            cascade: ptr::null_mut(),
        });

        // h1 is unref'd and never started: closing it must still hold the
        // loop alive until its endgame runs. // quirk: LOOP-27
        h1.core.unref();
        assert!(!loop_.alive());
        // h2 has a request in flight: its endgame must wait for the drain.
        h2.core.start();
        h2.core.req_submitted();

        h1.core.close();
        h2.core.close();
        assert!(loop_.alive());
        assert_eq!(loop_.active_handles(), 2);

        // Double-queue guard: want_endgame again is a no-op.
        h1.core.want_endgame();

        loop_.process_endgames();
        // h2 is NOT closed (request still pending); h1 closed, cascading h3
        // in the same phase. LIFO: h1 was pushed first... h1 then h3.
        assert_eq!(order, vec![1, 3]);
        assert!(h1.core.is_closed());
        assert!(h3.core.is_closed());
        assert!(!h2.core.is_closed());
        assert!(loop_.alive(), "h2 still closing");

        h2.core.req_completed();
        loop_.process_endgames();
        assert_eq!(order, vec![1, 3, 2]);
        assert!(h2.core.is_closed());
        assert!(!loop_.alive());
    }

    /// Resume wake-all: a null packet posted to every registered loop ends a
    /// blocking tick promptly; dropped loops are unregistered first and never
    /// posted to. // quirk: LOOP-38, LOOP-37
    #[test]
    fn wake_all_loops_wakes_blocking_ticks() {
        let _guard = serial();
        let mut a = Loop::new().unwrap();
        let b = Loop::new().unwrap();
        drop(b);
        wake_all_loops();
        let start = a.now_ms();
        let r = a.tick(Some(5_000));
        assert_eq!(r.dispatched, 0);
        assert!(a.now_ms() - start < 4_000, "wake_all did not end the wait");
    }

    /// process_init effects are observable: the error mode is set and CRT
    /// invalid-parameter calls return errors instead of terminating the
    /// process. // quirk: LOOP-40, LOOP-41, ADD-05, FSIO-44
    #[test]
    fn process_init_effects() {
        process_init();
        let mode = bun_windows_sys::kernel32::GetErrorMode();
        assert!(mode & bun_windows_sys::SEM_FAILCRITICALERRORS != 0);
        assert!(mode & bun_windows_sys::SEM_NOGPFAULTERRORBOX != 0);
        assert!(mode & bun_windows_sys::SEM_NOOPENFILEERRORBOX != 0);

        unsafe extern "C" {
            fn _get_osfhandle(fd: i32) -> isize;
        }
        // With the no-op handler installed this returns -1 (and the process
        // survives); without it, the default handler would terminate here.
        let h = unsafe { _get_osfhandle(7777) };
        assert_eq!(h, -1);
    }
}
