//! I/O attribution for scoped event-loop runs (see `bun_runtime::domain_run`).
//!
//! Readiness has no captured async context, so it is attributed by *time*: a
//! process-wide, monotonically increasing run epoch. Every `FilePoll` (and every
//! usockets socket, via `Bun__runEpoch`) records the epoch at creation; entering
//! a run bumps the epoch and remembers where it started. While a run is active,
//! readiness of a poll created *before* the run began belongs to outer code and
//! is not dispatched: the poll is disarmed (taken out of the kernel set, its
//! own flags untouched) and re-armed when the run exits, where — readiness being
//! level-triggered — it reports again, now for its real owner. Everything the run itself creates
//! (a spawned child's pipes, a connection it opens) carries a newer epoch and
//! dispatches normally.

use core::cell::Cell;
#[cfg(not(windows))]
use core::cell::RefCell;
use core::sync::atomic::{AtomicU32, Ordering};

static RUN_EPOCH: AtomicU32 = AtomicU32::new(1);

thread_local! {
    /// Start epoch of the innermost run on this thread; 0 when no run is active.
    static ACTIVE_RUN_START: Cell<u32> = const { Cell::new(0) };
    /// Polls this thread's runs have disarmed, oldest first.
    #[cfg(not(windows))]
    static DISARMED_POLLS: RefCell<Vec<*mut crate::FilePoll>> = const { RefCell::new(Vec::new()) };
}

/// The current epoch: what a poll or socket created right now is stamped with.
#[inline]
pub fn current() -> u32 {
    RUN_EPOCH.load(Ordering::Relaxed)
}

/// Start a fresh epoch and return it. Everything stamped from here on is `>=` it.
#[inline]
pub fn bump() -> u32 {
    RUN_EPOCH.fetch_add(1, Ordering::Relaxed) + 1
}

/// Start epoch of the innermost active run on this thread (0 = none). Readiness
/// of anything stamped `<` this is foreign to the run.
#[inline]
pub fn active_run_start() -> u32 {
    ACTIVE_RUN_START.get()
}

/// `bun_runtime::domain_run` only: entering a run (or restoring the outer run's
/// start on exit; 0 when leaving the outermost).
#[inline]
pub fn set_active_run_start(epoch: u32) {
    ACTIVE_RUN_START.set(epoch)
}

/// Whether readiness of something stamped `epoch` must wait for the active run to end.
#[inline]
pub fn is_foreign(epoch: u32) -> bool {
    let start = active_run_start();
    start != 0 && epoch < start
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__runEpoch() -> u32 {
    current()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__activeRunStartEpoch() -> u32 {
    active_run_start()
}

#[cfg(not(windows))]
pub(crate) fn remember_disarmed(poll: *mut crate::FilePoll) {
    DISARMED_POLLS.with_borrow_mut(|polls| polls.push(poll));
}

/// A disarmed poll is being unregistered, re-registered or freed by its owner:
/// it is the owner's again, so the run must not touch it on exit.
#[cfg(not(windows))]
pub(crate) fn forget_disarmed(poll: *mut crate::FilePoll) {
    DISARMED_POLLS.with_borrow_mut(|polls| {
        if let Some(i) = polls.iter().rposition(|p| core::ptr::eq(*p, poll)) {
            polls.remove(i);
        }
    });
}

/// A run on this thread has exited and `outer_start` is now the innermost run's
/// start epoch (0 if none). Re-arm every disarmed poll that is not still foreign
/// to that outer run; its pending readiness is reported again on the next poll.
///
/// # Safety
/// JS thread; `loop_` is this thread's live poll loop.
#[cfg(not(windows))]
pub unsafe fn rearm_after_run(loop_: *mut crate::Loop, outer_start: u32) {
    let ready: Vec<*mut crate::FilePoll> = DISARMED_POLLS.with_borrow_mut(|polls| {
        if outer_start == 0 {
            return core::mem::take(polls);
        }
        let mut ready = Vec::new();
        polls.retain(|&poll| {
            // SAFETY: entries are live: owners route unregister/deinit through
            // `forget_disarmed` before the slot can be reused.
            let still_foreign = unsafe { (*poll).epoch } < outer_start;
            if !still_foreign {
                ready.push(poll);
            }
            still_foreign
        });
        ready
    });
    for poll in ready {
        // SAFETY: as above; `loop_` per fn contract.
        unsafe { (*poll).rearm_after_run(&mut *loop_) };
    }
}
