//! Cross-thread wakeup. Implements core-semantics.md §10 (WAKEUP / DEFER):
//! `pending_wakeups` atomic increment/swap semantics and the wakeup-async
//! CALLBACK poll (eventfd / EVFILT_MACHPORT / EVFILT_USER / uv_async), the
//! only documented cross-thread entry points. Deferral stays in the surviving
//! C++ (`uws_loop_defer` → uWS deferQueues drained by wakeup_cb — R10.5: the
//! Rust core MUST NOT invent its own queue).

use core::ffi::c_void;

#[cfg(not(windows))]
use crate::backend::{CallbackPoll, Events, PollState, PollType};
use crate::loop_::Loop;
#[cfg(not(windows))]
use crate::loop_::WakeupAsync;
use crate::unsafe_core::ffi;
#[cfg(not(windows))]
use crate::unsafe_core::poll_access;

/// The ONLY thread-safe wakeup entry point. Takes a raw `*mut Loop` because
/// the loop thread may be parked inside [`us_loop_run`] concurrently —
/// forming `&mut Loop` here would alias (consumers/10-event-loop.md §8).
/// Callers own the liveness contract: the loop must not be freed while a
/// wake can race (worker teardown unpublishes the pointer under its lock
/// before `on_thread_exit`) — document it at every call site.
/// R10.1: RELEASE-bump `pending_wakeups` FIRST, then signal the async; the
/// counter is an optimization layered on top of the async, not a replacement.
pub fn us_wakeup_loop(loop_: *mut Loop) {
    #[cfg(not(windows))]
    {
        poll_access::pending_wakeups_add_release(loop_);
        async_send(ffi::read_wakeup_async(loop_));
    }
    #[cfg(windows)]
    {
        // libuv arm: just uv_async_send — no pending_wakeups field consumed.
        crate::backend::libuv::wakeup_async_send(ffi::read_wakeup_async(loop_));
    }
}

/// Raw run entry point for waker threads holding only a `*mut Loop`.
pub fn us_loop_run(loop_: *mut Loop) {
    crate::loop_::tick::run(loop_)
}

/// `uws_loop_defer`: run `cb(ctx)` once on the loop thread next iteration.
/// Cross-thread-safe — queueing lives in the surviving C++ LoopData
/// (deferMutex + double-buffered deferQueues, drained by the C++ wakeup_cb).
pub(crate) fn defer(loop_: *mut Loop, ctx: *mut c_void, cb: unsafe extern "C" fn(*mut c_void)) {
    ffi::loop_defer(loop_, ctx, cb);
}

/// ACQUIRE-swap `pending_wakeups` to 0 before blocking (R1.10 step 5); a
/// non-zero return forces `will_idle = false` — the GC safepoint is skipped
/// and the poll must not park (R10.2, C16).
#[cfg(not(windows))]
pub(crate) fn take_pending_wakeups(loop_: *mut Loop) -> u32 {
    poll_access::pending_wakeups_swap_acquire(loop_)
}

// ── wakeup async lifecycle (R10.4; POSIX arms — libuv arm lives in
//    backend/libuv.rs). Called only from ffi::create_loop_raw/free_loop_raw. ──

/// `us_internal_create_async(fallthrough=1)` + `us_internal_async_set(cb)`
/// fused (the C calls them back-to-back in loop_data_init). fallthrough:
/// no `num_polls` increment — the async never keeps the loop alive (R10.3).
#[cfg(not(windows))]
pub(crate) fn create_async(
    loop_: *mut Loop,
    cb: Option<unsafe extern "C" fn(*mut Loop)>,
) -> *mut WakeupAsync {
    let cb = cb.map(poll_access::erase_loop_cb);

    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let efd = poll_access::eventfd::create();
        if efd == -1 {
            // eventfd only fails on EMFILE/ENFILE; the loop is unusable
            // without wakeup_async — crash loudly (epoll_kqueue.c:613-618).
            panic!("eventfd() failed during loop init (out of file descriptors?)");
        }
        let mut state = PollState::init(efd, PollType::Callback);
        state.set_polling(Events::READABLE);
        let p = poll_access::alloc_callback_poll(CallbackPoll {
            state,
            loop_,
            cb,
            // Edge-triggered eventfd: dispatch never reads it.
            leave_poll_ready: true,
            cb_expects_the_loop: true,
        });
        let epfd = poll_access::loop_fd(loop_);
        let udata = p as usize as u64;
        // us_poll_start(READABLE) then the EPOLLIN|EPOLLET upgrade — the C's
        // two-step registration (epoll_kqueue.c:641-655).
        poll_access::epoll_ctl(epfd, libc::EPOLL_CTL_ADD, efd, libc::EPOLLIN as u32, udata);
        poll_access::epoll_ctl(
            epfd,
            libc::EPOLL_CTL_MOD,
            efd,
            (libc::EPOLLIN | libc::EPOLLET) as u32,
            udata,
        );
        p.cast::<WakeupAsync>()
    }

    #[cfg(target_os = "macos")]
    {
        let port = poll_access::mach::port_create_qlimit1();
        // The C returned NULL here and NULL-deref'd in async_set; fail at
        // the same point in time, but loudly.
        assert!(port != 0, "mach_port_allocate failed during loop init");
        let buf = poll_access::mach::alloc_buf();
        let mut state = PollState::init(0, PollType::Callback);
        state.set_polling(Events::READABLE);
        let p = poll_access::alloc_callback_poll(CallbackPoll {
            state,
            loop_,
            cb,
            leave_poll_ready: false,
            cb_expects_the_loop: true,
            port,
            machport_buf: buf,
        });
        let rc =
            poll_access::mach::kev_add(poll_access::loop_fd(loop_), port, buf, p as usize as u64);
        // The C aborts on registration failure (epoll_kqueue.c:755-757).
        assert!(
            rc != -1,
            "EVFILT_MACHPORT registration failed during loop init"
        );
        p.cast::<WakeupAsync>()
    }

    #[cfg(target_os = "freebsd")]
    {
        let mut state = PollState::init(0, PollType::Callback);
        state.set_polling(Events::READABLE);
        let p = poll_access::alloc_callback_poll(CallbackPoll {
            state,
            loop_,
            cb,
            leave_poll_ready: false,
            cb_expects_the_loop: true,
        });
        let ident = p as usize as u64;
        let rc = poll_access::evuser::add(poll_access::loop_fd(loop_), ident, ident);
        // The C aborts on registration failure (epoll_kqueue.c:846-848).
        assert!(rc != -1, "EVFILT_USER registration failed during loop init");
        p.cast::<WakeupAsync>()
    }
}

/// `us_internal_async_wakeup` — callable from ANY thread; reads only fields
/// that are immutable after creation.
#[cfg(not(windows))]
fn async_send(a: *mut WakeupAsync) {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let fd = poll_access::read_poll(a.cast::<PollState>()).fd();
        poll_access::eventfd::send(fd);
    }
    #[cfg(target_os = "macos")]
    {
        let cp = poll_access::read_callback_poll(a.cast::<CallbackPoll>());
        poll_access::mach::send(cp.port);
    }
    #[cfg(target_os = "freebsd")]
    {
        let cp = poll_access::read_callback_poll(a.cast::<CallbackPoll>());
        poll_access::evuser::trigger(
            poll_access::loop_fd(cp.loop_),
            a as usize as u64,
            a as usize as u64,
        );
    }
}

/// `us_internal_async_close` (loop teardown only). Preserves the C quirk:
/// created with fallthrough (no `num_polls++`), but freed through
/// `us_poll_free`, which decrements — a net −1 at teardown.
#[cfg(not(windows))]
pub(crate) fn close_async(loop_: *mut Loop, a: *mut WakeupAsync) {
    if a.is_null() {
        return;
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        // us_poll_stop: EPOLL_CTL_DEL + scrub of pending ready entries.
        crate::backend::poll_stop(a.cast::<PollState>(), loop_);
        let fd = poll_access::read_poll(a.cast::<PollState>()).fd();
        crate::unsafe_core::io::close(fd, false);
    }
    #[cfg(target_os = "macos")]
    {
        let cp = poll_access::read_callback_poll(a.cast::<CallbackPoll>());
        poll_access::mach::kev_delete(poll_access::loop_fd(loop_), cp.port, a as usize as u64);
        poll_access::mach::port_dealloc(cp.port);
        poll_access::mach::free_buf(cp.machport_buf);
    }
    #[cfg(target_os = "freebsd")]
    {
        poll_access::evuser::delete(
            poll_access::loop_fd(loop_),
            a as usize as u64,
            a as usize as u64,
        );
    }
    poll_access::num_polls_add(loop_, -1);
    poll_access::free_callback_poll(a.cast::<CallbackPoll>());
}
