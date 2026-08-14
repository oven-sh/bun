//! Attribution for domain runs (see `bun_runtime::domain_run`).
//!
//! Every schedulable thing — event-loop task, timer, immediate, `FilePoll`,
//! usockets poll (via `Bun__runEpoch`), and, through the async context, every
//! microtask and `process.nextTick` — records its *birth epoch*: the value of one
//! process-wide, monotonically increasing counter at the moment it was created
//! (all of it happens on the owning JS thread). Entering a run bumps the counter and remembers where it
//! started, so a run is named by its start epoch and "is this mine?" is one
//! comparison: anything born before the run started belongs to the code the run
//! interrupted (*foreign*) and is held until the run exits; anything born since
//! — by the run's own code, or by a run nested inside it — is a consequence of
//! the run and proceeds. A task whose birth nobody knows (posted from another
//! thread without a ticket) is born 0, which is foreign to every run: whoever
//! it belongs to, it is not the run.
//!
//! For I/O the hold is physical: a foreign poll that becomes ready is taken out
//! of the kernel set (its own flags untouched) and put back when the run exits,
//! where — readiness being level-triggered — it reports again for its owner
//! (`crate::held_polls` for `FilePoll`; usockets keeps its own list per loop).

use core::cell::Cell;
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
/// Per-thread run state, in one TLS block so every gate is a single TLS access.
struct RunTls {
    /// Start epoch of the innermost run on this thread (`PRIMORDIAL` at the
    /// root; 0 before the VM's root run is entered / on threads with no VM).
    active_start: Cell<u32>,
    /// How many runs are on this thread's stack (1 = only the root).
    depth: Cell<u32>,
    /// Whether that run's own consequences include scripts
    /// (`bun_runtime::domain_run::Policy::NativeAndScripts`).
    active_executes_scripts: Cell<bool>,
}

thread_local! {
    static RUN: RunTls = const {
        RunTls { active_start: Cell::new(0), depth: Cell::new(0), active_executes_scripts: Cell::new(false) }
    };
}

/// The current epoch: what something created right now on a JS thread is born with.
#[inline]
pub fn current() -> u32 {
    RUN_EPOCH.load(Ordering::Relaxed) & EPOCH_MASK
}

/// Start a fresh epoch and return it. Everything born from here on is "since"
/// it. Comparison is serial-number arithmetic in 31 bits, so the counter may
/// wrap; 0 (unknown) and `PRIMORDIAL` are skipped and stay older than everything.
#[inline]
pub fn bump() -> u32 {
    loop {
        let next = (RUN_EPOCH.fetch_add(1, Ordering::Relaxed).wrapping_add(1)) & EPOCH_MASK;
        if next > PRIMORDIAL {
            return next;
        }
    }
}

/// `a` happened before `b` (both real epochs), in 31-bit serial arithmetic.
#[inline]
pub fn before(a: u32, b: u32) -> bool {
    ((a.wrapping_sub(b) << 1) as i32) < 0
}

/// Birth epoch for something a JS thread creates right now (see the doors that
/// call this: `EventLoop::enqueue_task`, `Ticket::issue`, timer/immediate arm).
#[inline]
pub fn birth() -> u32 {
    current()
}

/// Start epoch of the innermost active run on this thread (0 = none).
#[inline]
pub fn active_run_start() -> u32 {
    RUN.with(|r| r.active_start.get())
}

/// Whether a native-only run is active on this thread (`Policy::Native`): one
/// whose own consequences include no script, so housekeeping that acts for
/// outer owners (auto-flush queues, embedder loop hooks) waits too.
#[inline]
pub fn active_run_is_native_only() -> bool {
    RUN.with(|r| r.depth.get() > 1 && !r.active_executes_scripts.get())
}

/// Depth of this thread's run stack: 0 before the root run, 1 at the root,
/// more while a nested run (a blocked frame) is active.
#[inline]
pub fn run_depth() -> u32 {
    RUN.with(|r| r.depth.get())
}

/// `bun_jsc::domain_run` only: a run was entered on this thread.
#[inline]
pub fn push_run(start: u32, executes_scripts: bool) {
    RUN.with(|r| {
        r.depth.set(r.depth.get() + 1);
        r.active_start.set(start);
        r.active_executes_scripts.set(executes_scripts);
    })
}

/// `bun_jsc::domain_run` only: the innermost run exited; `outer_*` describe
/// the run that is now innermost.
#[inline]
pub fn pop_run(outer_start: u32, outer_executes_scripts: bool) {
    RUN.with(|r| {
        debug_assert!(r.depth.get() > 0);
        r.depth.set(r.depth.get() - 1);
        r.active_start.set(outer_start);
        r.active_executes_scripts.set(outer_executes_scripts);
    })
}

/// Whether something born at `birth` must wait for the run that started at
/// `start`. Nothing predates the root (`start <= PRIMORDIAL`); to a nested run,
/// the program's own (`PRIMORDIAL`), unknown (0) and older births are foreign.
#[inline]
pub fn is_foreign_to(birth: u32, start: u32) -> bool {
    start > PRIMORDIAL && (birth <= PRIMORDIAL || before(birth, start))
}

/// Whether something born at `birth` must wait for the active run to end.
#[inline]
pub fn is_foreign(birth: u32) -> bool {
    is_foreign_to(birth, active_run_start())
}
