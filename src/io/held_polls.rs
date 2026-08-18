//! `FilePoll`s a domain run on this thread has custody of (see `crate::run_epoch`
//! and `FilePoll::disarm_for_run`): taken out of the kernel set because their
//! readiness surfaced during a run they are foreign to, and re-registered when
//! that run exits — or, for readiness the kernel delivers only once (kqueue
//! process exit), replayed to the owner from the loop.

use core::cell::RefCell;

use crate::FilePoll;

/// Readiness the kernel will not report again (kqueue `EVFILT_PROC NOTE_EXIT`),
/// kept to be replayed to the owner once the run it waited for is over.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
struct Replay {
    poll: *mut FilePoll,
    event: crate::posix_event_loop::KQueueEvent,
    /// The run it waited for is over; `replay_ready` delivers it from the loop.
    ready: bool,
}

thread_local! {
    /// Disarmed polls, oldest first; re-armed when their run exits.
    static DISARMED: RefCell<Vec<*mut FilePoll>> = const { RefCell::new(Vec::new()) };
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    static REPLAYS: RefCell<Vec<Replay>> = const { RefCell::new(Vec::new()) };
}

pub(crate) fn remember_disarmed(poll: *mut FilePoll) {
    DISARMED.with_borrow_mut(|polls| polls.push(poll));
}

/// As `remember_disarmed`, for readiness that cannot be re-armed and is
/// replayed to the owner after the run instead.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub(crate) fn remember_replay(poll: *mut FilePoll, event: crate::posix_event_loop::KQueueEvent) {
    REPLAYS.with_borrow_mut(|replays| {
        replays.push(Replay {
            poll,
            event,
            ready: false,
        })
    });
}

/// A disarmed poll is being unregistered, re-registered or freed by its owner:
/// it is the owner's again, so the run must not touch it on exit.
pub(crate) fn forget_disarmed(poll: *mut FilePoll) {
    let found = DISARMED.with_borrow_mut(|polls| {
        polls
            .iter()
            .rposition(|&p| core::ptr::eq(p, poll))
            .map(|i| polls.remove(i))
            .is_some()
    });
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    if !found {
        REPLAYS.with_borrow_mut(|replays| {
            if let Some(i) = replays.iter().rposition(|r| core::ptr::eq(r.poll, poll)) {
                replays.remove(i);
            }
        });
    }
    #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
    let _ = found;
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
#[must_use]
pub unsafe fn release_after_run(loop_: *mut crate::Loop, outer_start: u32) -> bool {
    // SAFETY (both lists): entries are live — owners route unregister/deinit
    // through `forget_disarmed` before the slot can be reused.
    let still_foreign =
        |poll: *mut FilePoll| crate::run_epoch::is_foreign_to(unsafe { (*poll).epoch }, outer_start);
    let rearm: Vec<*mut FilePoll> = DISARMED.with_borrow_mut(|polls| {
        let mut rearm = Vec::new();
        polls.retain(|&poll| still_foreign(poll) || {
            rearm.push(poll);
            false
        });
        rearm
    });
    for poll in rearm {
        // SAFETY: as above; `loop_` per fn contract.
        unsafe { (*poll).rearm_after_run(&mut *loop_) };
    }
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    return REPLAYS.with_borrow_mut(|replays| {
        let mut any = false;
        for replay in replays.iter_mut().filter(|r| !still_foreign(r.poll)) {
            replay.ready = true;
            any = true;
        }
        any
    });
    #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
    false
}

/// Deliver, from the loop, every held readiness whose run has ended
/// (see [`release_after_run`]).
///
/// # Safety
/// JS thread, from the event loop's task queue.
pub unsafe fn replay_ready() {
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    loop {
        // One at a time: delivering re-enters the owner, which may free this or
        // other polls (`forget_disarmed`) or start a run of its own.
        let next = REPLAYS.with_borrow_mut(|replays| {
            let i = replays.iter().position(|r| r.ready)?;
            let r = replays.remove(i);
            Some((r.poll, r.event))
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
