//! SIGINT/SIGTERM/SIGHUP hook for a process that supervises background
//! children and must forward the signal to them before it exits (today:
//! `bun install` while lifecycle scripts run). The handler records the
//! signal and posts a task to the supervisor's `MiniEventLoop`; the
//! supervisor's callback decides what to forward and when to exit.
//!
//! Unlike [`crate::ctrl_c`] (foreground child sharing the terminal, nothing
//! forwarded), this is for children that a pid-targeted signal never reaches.

use core::ffi::c_int;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicI32, AtomicPtr, Ordering};

use bun_core::Mutex;
use bun_event_loop::AnyTaskWithExtraContext::{AnyTaskWithExtraContext, New};
use bun_event_loop::EventLoopHandle;
use bun_event_loop::MiniEventLoop::MiniEventLoop;

pub const SIGNALS: [c_int; 3] = [libc::SIGINT, libc::SIGTERM, libc::SIGHUP];

/// Last hooked signal received, 0 when none. Never cleared, so a task queued
/// under one hook still sees it after an unhook/hook cycle.
static RECEIVED: AtomicI32 = AtomicI32::new(0);
/// `TASK` is in the loop's queue. `SeqCst` with `RECEIVED`: a handler (any
/// thread) that sees this set relies on the queued task reading its store.
static QUEUED: AtomicBool = AtomicBool::new(false);
static EVENT_LOOP: AtomicPtr<MiniEventLoop> = AtomicPtr::new(core::ptr::null_mut());
/// Allocated once, never freed: the handler must not allocate.
static TASK: AtomicPtr<AnyTaskWithExtraContext> = AtomicPtr::new(core::ptr::null_mut());
static ON_SIGNAL: Mutex<Option<fn(c_int)>> = Mutex::new(None);
/// Dispositions replaced by `hook`; `None` while not hooked.
static PREVIOUS: Mutex<Option<[libc::sigaction; SIGNALS.len()]>> = Mutex::new(None);

/// Until [`unhook`], a hooked signal wakes `event_loop` and runs
/// `on_signal(sig)` on its thread at the next tick (signals coalesce; the
/// latest wins). An inherited `SIG_IGN` is left alone. Returns `false` for a
/// JS event loop, where the runtime owns process signals. Call from the
/// loop's thread.
pub fn hook(event_loop: EventLoopHandle, on_signal: fn(c_int)) -> bool {
    let EventLoopHandle::Mini(mini) = event_loop else {
        return false;
    };
    let mut previous = PREVIOUS.lock();
    *ON_SIGNAL.lock() = Some(on_signal);
    if previous.is_some() {
        return true;
    }
    if TASK.load(Ordering::Relaxed).is_null() {
        let task = New::<(), ()>::init(NonNull::<()>::dangling().as_ptr(), run_task);
        TASK.store(bun_core::heap::into_raw(Box::new(task)), Ordering::Relaxed);
    }
    // Published before the dispositions so the handler always finds a loop.
    EVENT_LOOP.store(mini.as_ptr(), Ordering::Release);

    let mut saved: [libc::sigaction; SIGNALS.len()] = [bun_core::ffi::zeroed(); SIGNALS.len()];
    // SAFETY: zeroed `sigaction` is valid; all pointers are to live locals.
    unsafe {
        let mut act: libc::sigaction = bun_core::ffi::zeroed();
        act.sa_sigaction = handler as *const () as usize;
        act.sa_flags = libc::SA_RESTART;
        libc::sigemptyset(&raw mut act.sa_mask);
        for (i, sig) in SIGNALS.iter().enumerate() {
            if libc::sigaction(*sig, core::ptr::null(), &raw mut saved[i]) != 0 {
                continue;
            }
            if saved[i].sa_sigaction == libc::SIG_IGN {
                continue;
            }
            libc::sigaction(*sig, &raw const act, core::ptr::null_mut());
        }
    }
    *previous = Some(saved);
    true
}

/// Restores the dispositions [`hook`] replaced. [`received`] keeps its value.
/// No-op when not hooked.
pub fn unhook() {
    let mut previous = PREVIOUS.lock();
    let Some(saved) = previous.take() else {
        return;
    };
    // SAFETY: `saved` holds dispositions the kernel returned in `hook`.
    unsafe {
        for (i, sig) in SIGNALS.iter().enumerate() {
            libc::sigaction(*sig, &raw const saved[i], core::ptr::null_mut());
        }
    }
    EVENT_LOOP.store(core::ptr::null_mut(), Ordering::Release);
}

/// The last hooked signal received, if any (also after [`unhook`]).
pub fn received() -> Option<c_int> {
    match RECEIVED.load(Ordering::SeqCst) {
        0 => None,
        sig => Some(sig),
    }
}

extern "C" fn handler(sig: c_int) {
    RECEIVED.store(sig, Ordering::SeqCst);
    if QUEUED.swap(true, Ordering::SeqCst) {
        return;
    }
    let event_loop = EVENT_LOOP.load(Ordering::Acquire);
    let task = NonNull::new(TASK.load(Ordering::Relaxed));
    let (false, Some(task)) = (event_loop.is_null(), task) else {
        // Raced with `unhook` on another thread: take the default action.
        // `sig` is blocked in its own handler, so the raise lands on return.
        QUEUED.store(false, Ordering::SeqCst);
        // SAFETY: zeroed `sigaction` is valid; both calls are async-signal-safe.
        unsafe {
            let mut act: libc::sigaction = bun_core::ffi::zeroed();
            act.sa_sigaction = libc::SIG_DFL;
            libc::sigaction(sig, &raw const act, core::ptr::null_mut());
            libc::raise(sig);
        }
        return;
    };
    // SAFETY: the loop is live while hooked; `task` is not queued (`QUEUED`
    // was false). Raw form because this may interrupt the loop inside `tick`.
    unsafe { MiniEventLoop::enqueue_task_concurrent_raw(event_loop, task) };
}

fn run_task(_: *mut (), _: *mut ()) {
    QUEUED.store(false, Ordering::SeqCst);
    let on_signal = *ON_SIGNAL.lock();
    if let (Some(on_signal), Some(sig)) = (on_signal, received()) {
        on_signal(sig);
    }
}
