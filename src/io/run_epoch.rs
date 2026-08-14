//! I/O attribution for domain runs (see `bun_runtime::domain_run`).
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

/// Read directly by usockets (`Bun__runEpoch()` in internal.h is a relaxed load
/// of this symbol), so it is exported under a C name.
#[unsafe(no_mangle)]
#[allow(non_upper_case_globals)]
pub static Bun__runEpochCounter: AtomicU32 = AtomicU32::new(1);
use Bun__runEpochCounter as RUN_EPOCH;

/// A poll a run on this thread has custody of.
#[cfg(not(windows))]
struct Disarmed {
    poll: *mut crate::FilePoll,
    /// The readiness itself when it cannot be re-armed (kqueue `EVFILT_PROC
    /// NOTE_EXIT` is delivered once): replayed to the owner after the run.
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    replay: Option<crate::posix_event_loop::KQueueEvent>,
    /// The run it waited for is over; `replay_ready` delivers it from the loop.
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    ready: bool,
}

thread_local! {
    /// Start epoch of the innermost run on this thread; 0 when no run is active.
    static ACTIVE_RUN_START: Cell<u32> = const { Cell::new(0) };
    /// Polls this thread's runs have disarmed, oldest first.
    #[cfg(not(windows))]
    static DISARMED_POLLS: RefCell<Vec<Disarmed>> = const { RefCell::new(Vec::new()) };
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

#[cfg(not(windows))]
pub(crate) fn remember_disarmed(poll: *mut crate::FilePoll) {
    DISARMED_POLLS.with_borrow_mut(|polls| {
        polls.push(Disarmed {
            poll,
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            replay: None,
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            ready: false,
        })
    });
}

/// As `remember_disarmed`, for readiness that cannot be re-armed and is
/// replayed to the owner after the run instead.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub(crate) fn remember_replay(
    poll: *mut crate::FilePoll,
    event: crate::posix_event_loop::KQueueEvent,
) {
    DISARMED_POLLS.with_borrow_mut(|polls| {
        polls.push(Disarmed {
            poll,
            replay: Some(event),
            ready: false,
        })
    });
}

/// A disarmed poll is being unregistered, re-registered or freed by its owner:
/// it is the owner's again, so the run must not touch it on exit.
#[cfg(not(windows))]
pub(crate) fn forget_disarmed(poll: *mut crate::FilePoll) {
    DISARMED_POLLS.with_borrow_mut(|polls| {
        if let Some(i) = polls.iter().rposition(|d| core::ptr::eq(d.poll, poll)) {
            polls.remove(i);
        }
    });
}

/// A run on this thread has exited and `outer_start` is now the innermost run's
/// start epoch (0 if none). Re-arm every disarmed poll that is not still foreign
/// to that outer run; its pending readiness is reported again on the next poll.
/// Returns whether any held readiness must instead be replayed: the caller then
/// schedules [`replay_ready`] on the loop (not here — the owner's callback is
/// outer code and must not run inside the frame that is unwinding the run).
///
/// # Safety
/// JS thread; `loop_` is this thread's live poll loop.
#[cfg(not(windows))]
#[must_use]
pub unsafe fn rearm_after_run(loop_: *mut crate::Loop, outer_start: u32) -> bool {
    #[allow(unused_mut)]
    let mut needs_replay = false;
    let rearm: Vec<*mut crate::FilePoll> = DISARMED_POLLS.with_borrow_mut(|polls| {
        let mut rearm = Vec::new();
        #[allow(clippy::unnecessary_mut_passed)]
        polls.retain_mut(|d| {
            // SAFETY: entries are live: owners route unregister/deinit through
            // `forget_disarmed` before the slot can be reused.
            if outer_start != 0 && unsafe { (*d.poll).epoch } < outer_start {
                return true; // still foreign to the outer run: stays held
            }
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            if d.replay.is_some() {
                d.ready = true;
                needs_replay = true;
                return true; // stays listed (and forgettable) until replayed
            }
            rearm.push(d.poll);
            false
        });
        rearm
    });
    for poll in rearm {
        // SAFETY: as above; `loop_` per fn contract.
        unsafe { (*poll).rearm_after_run(&mut *loop_) };
    }
    needs_replay
}

/// Deliver, from the loop, every held readiness whose run has ended
/// (see [`rearm_after_run`]).
///
/// # Safety
/// JS thread, from the event loop's task queue.
#[cfg(not(windows))]
pub unsafe fn replay_ready() {
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    loop {
        // One at a time: delivering re-enters the owner, which may free this or
        // other polls (`forget_disarmed`) or start a run of its own.
        let next = DISARMED_POLLS.with_borrow_mut(|polls| {
            let i = polls.iter().position(|d| d.ready)?;
            let d = polls.remove(i);
            Some((d.poll, d.replay.expect("ready implies replay")))
        });
        let Some((poll, event)) = next else { break };
        // SAFETY: live per the list invariant above; it just left the list, so
        // clear the flag `forget_run_disarm` keys on before re-entering.
        unsafe {
            (*poll)
                .flags
                .remove(crate::posix_event_loop::Flags::DisarmedByRun);
            (*poll).on_kqueue_event(&event);
        }
    }
}
