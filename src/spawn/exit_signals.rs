//! SIGINT, SIGTERM and SIGHUP for a bun process that supervises background
//! children: `bun install` while lifecycle scripts run. Such a process must
//! not go away before the children have seen the signal, so it hooks the
//! signals, forwards one to the children, waits for them, and then ends the
//! way the signal asked. This module is the hook. It records the signal and
//! runs the supervisor's callback on the thread that ticks its event loop.
//! What to forward and when to exit stays with the supervisor.
//!
//! The handler does async-signal-safe work only: atomics, one lock-free
//! `UnboundedQueue` push and the loop's wakeup write, through
//! `MiniEventLoop::enqueue_task_concurrent` (the entry other threads use to
//! post to the loop). A disposition inherited as `SIG_IGN` (`nohup`, a `&`
//! job in a non-interactive shell) is left alone.
//!
//! This is not [`crate::ctrl_c`]: that one is for a foreground child that
//! shares the terminal, where a Ctrl+C already reaches the child and nothing
//! is forwarded.

use core::ffi::c_int;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicI32, AtomicPtr, Ordering};

use bun_core::Mutex;
use bun_event_loop::AnyTaskWithExtraContext::{AnyTaskWithExtraContext, New};
use bun_event_loop::EventLoopHandle;
use bun_event_loop::MiniEventLoop::MiniEventLoop;

pub const SIGNALS: [c_int; 3] = [libc::SIGINT, libc::SIGTERM, libc::SIGHUP];

/// The last hooked signal received, 0 when none. Never cleared: a signal
/// that lands while the supervisor swaps one child for the next (unhook,
/// hook again) is still acted on by the task it queued.
static RECEIVED: AtomicI32 = AtomicI32::new(0);
/// Set while `TASK` sits in the event loop queue: a node must not be pushed
/// twice. `RECEIVED` and `QUEUED` are `SeqCst`: a handler that finds
/// `QUEUED` set relies on the queued task to read its `RECEIVED` store, and
/// the handler can run on any thread.
static QUEUED: AtomicBool = AtomicBool::new(false);
static EVENT_LOOP: AtomicPtr<MiniEventLoop> = AtomicPtr::new(core::ptr::null_mut());
/// Allocated by the first `hook`, never freed: the handler must not allocate.
static TASK: AtomicPtr<AnyTaskWithExtraContext> = AtomicPtr::new(core::ptr::null_mut());
/// Only read on the event loop thread.
static ON_SIGNAL: Mutex<Option<fn(c_int)>> = Mutex::new(None);
/// The dispositions `hook` replaced, `None` while not hooked.
static PREVIOUS: Mutex<Option<[libc::sigaction; SIGNALS.len()]>> = Mutex::new(None);

/// Hooks SIGINT, SIGTERM and SIGHUP. From now until [`unhook`], a signal runs
/// `on_signal(signal)` on the thread that ticks `event_loop`, at its next
/// tick, and the loop is woken for it. Signals that arrive before the
/// callback runs coalesce into one call with the latest. A callback queued
/// under an earlier hook still runs, with this `on_signal`. Call it from the
/// loop's thread.
///
/// Returns `false` and hooks nothing for a JS event loop: the runtime owns
/// the process signals there.
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
        // The callback reads the statics; the task context is unused.
        let task = New::<(), ()>::init(NonNull::<()>::dangling().as_ptr(), run_task);
        TASK.store(bun_core::heap::into_raw(Box::new(task)), Ordering::Relaxed);
    }
    // Before the dispositions: the handler never runs without a loop. The
    // loop outlives the hook (the `EventLoopHandle` invariant).
    EVENT_LOOP.store(mini.as_ptr(), Ordering::Release);

    let mut saved: [libc::sigaction; SIGNALS.len()] = [bun_core::ffi::zeroed(); SIGNALS.len()];
    // SAFETY: all-zero is a valid `libc::sigaction`; `sigemptyset` and
    // `sigaction` get pointers to live stack values.
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

/// Restores the dispositions [`hook`] replaced: a later signal takes the
/// previous action, and the default one ends the process. [`received`] keeps
/// its value. Does nothing when not hooked.
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
    // After the dispositions: the handler never runs without a loop.
    EVENT_LOOP.store(core::ptr::null_mut(), Ordering::Release);
}

/// The last hooked signal received, if any. Still set after [`unhook`], for
/// a supervisor that ends by it once its children are gone.
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
        // Only reachable on another thread while `unhook` restores the
        // dispositions. Take the default action rather than drop the signal:
        // `sig` is blocked inside its own handler, so the re-raise lands on
        // return.
        QUEUED.store(false, Ordering::SeqCst);
        // SAFETY: all-zero is a valid `libc::sigaction`; both calls are
        // async-signal-safe.
        unsafe {
            let mut act: libc::sigaction = bun_core::ffi::zeroed();
            act.sa_sigaction = libc::SIG_DFL;
            libc::sigaction(sig, &raw const act, core::ptr::null_mut());
            libc::raise(sig);
        }
        return;
    };
    // SAFETY: `EVENT_LOOP` is live while the dispositions are installed (see
    // `hook`/`unhook`), and `task` is not in the queue (`QUEUED` was false).
    // The raw form: this may have interrupted the loop's thread inside `tick`.
    unsafe { MiniEventLoop::enqueue_task_concurrent_raw(event_loop, task) };
}

fn run_task(_: *mut (), _: *mut ()) {
    QUEUED.store(false, Ordering::SeqCst);
    let on_signal = *ON_SIGNAL.lock();
    if let (Some(on_signal), Some(sig)) = (on_signal, received()) {
        on_signal(sig);
    }
}
