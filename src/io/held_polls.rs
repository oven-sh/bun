//! `FilePoll`s a domain run on this thread has custody of (see `crate::run_epoch`
//! and `FilePoll::disarm_for_run`): taken out of the kernel set because their
//! readiness surfaced during a run they are foreign to, and re-registered when
//! that run exits — or, for readiness the kernel delivers only once (kqueue
//! process exit), replayed to the owner from the loop.

use core::cell::RefCell;

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
    /// Oldest first.
    static DISARMED_POLLS: RefCell<Vec<Disarmed>> = const { RefCell::new(Vec::new()) };
}

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
#[must_use]
pub unsafe fn release_after_run(loop_: *mut crate::Loop, outer_start: u32) -> bool {
    #[allow(unused_mut)]
    let mut needs_replay = false;
    let rearm: Vec<*mut crate::FilePoll> = DISARMED_POLLS.with_borrow_mut(|polls| {
        let mut rearm = Vec::new();
        #[allow(clippy::unnecessary_mut_passed)]
        polls.retain_mut(|d| {
            // SAFETY: entries are live: owners route unregister/deinit through
            // `forget_disarmed` before the slot can be reused.
            if crate::run_epoch::is_foreign_to(unsafe { (*d.poll).epoch }, outer_start) {
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
/// (see [`release_after_run`]).
///
/// # Safety
/// JS thread, from the event loop's task queue.
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
