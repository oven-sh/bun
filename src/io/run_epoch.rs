//! Attribution for domain runs (see `bun_runtime::domain_run`).
//!
//! Every schedulable thing — event-loop task, timer, immediate, `FilePoll`,
//! usockets poll (via `Bun__runEpoch`), and, through the async context, every
//! microtask and `process.nextTick` — records its *birth epoch*: the value of one
//! process-wide, monotonically increasing counter at the moment it was created
//! on a JS thread. Entering a run bumps the counter and remembers where it
//! started, so a run is named by its start epoch and "is this mine?" is one
//! comparison: anything born before the run started belongs to the code the run
//! interrupted (*foreign*) and is held until the run exits; anything born since
//! — by the run's own code, or by a run nested inside it — is a consequence of
//! the run and proceeds. Things created on a thread that owns no VM are born 0,
//! which is foreign to every run: whoever they belong to, it is not the run.
//!
//! For I/O the hold is physical: a foreign poll that becomes ready is taken out
//! of the kernel set (its own flags untouched) and put back when the run exits,
//! where — readiness being level-triggered — it reports again for its owner.

use core::cell::Cell;
#[cfg(not(windows))]
use core::cell::RefCell;
use core::sync::atomic::{AtomicU32, Ordering};

/// Read directly by usockets (`Bun__runEpoch()` in internal.h is a relaxed load
/// of this symbol), so it is exported under a C name. usockets keeps 31 bits.
#[unsafe(no_mangle)]
#[allow(non_upper_case_globals)]
pub static Bun__runEpochCounter: AtomicU32 = AtomicU32::new(PRIMORDIAL);
use Bun__runEpochCounter as RUN_EPOCH;
const EPOCH_MASK: u32 = 0x7fff_ffff;

/// The first epoch: older than every run. The birth to give something that
/// belongs to the program as a whole no matter when it is materialized (a
/// delivered signal).
pub const PRIMORDIAL: u32 = 1;

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

/// Per-thread run state, in one TLS block so every gate is a single TLS access.
struct RunTls {
    /// Start epoch of the innermost run on this thread; 0 when no run is active.
    active_start: Cell<u32>,
    /// Whether that run is strict (executes no code of its own; see
    /// `bun_runtime::domain_run::Policy`).
    active_strict: Cell<bool>,
    /// This thread owns a JS VM: what it creates has a birth epoch. Other
    /// threads' creations are born 0 (foreign to every run).
    js_thread: Cell<bool>,
}

thread_local! {
    static RUN: RunTls = const {
        RunTls { active_start: Cell::new(0), active_strict: Cell::new(false), js_thread: Cell::new(false) }
    };
    /// Polls this thread's runs have disarmed, oldest first.
    #[cfg(not(windows))]
    static DISARMED_POLLS: RefCell<Vec<Disarmed>> = const { RefCell::new(Vec::new()) };
}

/// The current epoch: what something created right now on a JS thread is born with.
#[inline]
pub fn current() -> u32 {
    RUN_EPOCH.load(Ordering::Relaxed) & EPOCH_MASK
}

/// Start a fresh epoch and return it. Everything born from here on is `>=` it.
#[inline]
pub fn bump() -> u32 {
    let next = (RUN_EPOCH.fetch_add(1, Ordering::Relaxed) + 1) & EPOCH_MASK;
    assert!(next != 0, "run epochs exhausted");
    next
}

/// This thread owns a JS VM (main thread or a Worker). Idempotent.
#[inline]
pub fn mark_js_thread() {
    RUN.with(|r| r.js_thread.set(true));
}

/// Birth epoch for something created right now on this thread: the current
/// epoch on a JS thread, 0 elsewhere.
#[inline]
pub fn birth() -> u32 {
    if RUN.with(|r| r.js_thread.get()) {
        current()
    } else {
        0
    }
}

/// Start epoch of the innermost active run on this thread (0 = none).
#[inline]
pub fn active_run_start() -> u32 {
    RUN.with(|r| r.active_start.get())
}

/// Whether a strict run is active on this thread: one that executes no code of
/// its own, so housekeeping that acts for outer owners (auto-flush queues,
/// embedder loop hooks) waits too.
#[inline]
pub fn active_run_is_strict() -> bool {
    RUN.with(|r| r.active_start.get() != 0 && r.active_strict.get())
}

/// `bun_runtime::domain_run` only: entering a run (or restoring the outer run
/// on exit; start 0 when leaving the outermost).
#[inline]
pub fn set_active_run(start: u32, strict: bool) {
    RUN.with(|r| {
        r.active_start.set(start);
        r.active_strict.set(strict);
    })
}

/// Whether something born at `birth` must wait for the active run to end.
#[inline]
pub fn is_foreign(birth: u32) -> bool {
    let start = active_run_start();
    start != 0 && birth < start
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
