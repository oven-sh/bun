//! `bun_jsc::Task` — the hoisted task-dispatch tag/ptr pair.
//!
//! Per `docs/PORTING.md` §Dispatch hot-path: this crate (low/mid tier) only
//! stores `{ tag: u8, ptr: *mut () }` and a one-shot hook; the per-tick
//! `match` over all ~96 variant types lives in `bun_runtime::dispatch`
//! (high tier — it owns every variant type). LLVM inlines the high-tier arms;
//! this layer never names a variant.
//!
//! To add a new task to the queue:
//! 1. Add a tag constant to `bun_event_loop::task_tag` (the canonical list).
//! 2. `impl bun_jsc::Taskable for YourType { const TAG = task_tag::YourType; }`
//!    in the crate that owns `YourType`.
//! 3. Add a match arm in `bun_runtime::dispatch::run_task` (and `__bun_release_task_unrun`).

use crate::event_loop::Stopped;
use crate::{JSGlobalObject, JsError};

// ─── Task / TaskTag / Taskable ───────────────────────────────────────────────
// The struct + tag table + type→tag trait are defined once in `bun_event_loop`
// (lowest tier on the hot-path list) and re-exported here so callers can write
// `bun_jsc::Task` / `bun_jsc::Taskable` without reaching down a tier.
pub use bun_event_loop::{Task, TaskTag, Taskable, task_tag};

// ─── run_tasks dispatch ─────────────────────────────────────────────────────
// The per-tick dispatch entry point is `bun_jsc::event_loop::tick_queue_with_
// count` (declares `__bun_tick_queue_with_count`, defined in
// `bun_runtime::dispatch`). The former duplicate `__bun_run_tasks` extern +
// `pub fn run_tasks` wrapper here had no callers and aliased the same body —
// deleted r6 (one symbol per dispatch entry, per PORTING.md §extern-Rust-ban).

/// The fold: what a dispatcher does with the `Err` a callback it invoked came back with — report the
/// exception as uncaught, or, if it is the VM's termination, stand down (WebCore:
/// `isTerminationException(returned)`) — then run the microtask checkpoint the scopes beneath skipped
/// over the pending exception. A termination that got here still pending (read through a proof-less
/// `has_exception()`, or this fold runs beneath script) is taken now if no script is left to unwind.
#[cold]
pub fn report_error_or_terminate(global: &JSGlobalObject, proof: JsError) -> Result<(), Stopped> {
    let ex = global.take_exception(proof);
    if ex.is_termination_exception() {
        crate::top_exception_scope::thrown(global);
        return Err(Stopped);
    }
    let vm = global.bun_vm();
    let _ = vm.as_mut().uncaught_exception(
        global,
        ex,
        crate::virtual_machine::UncaughtExceptionOrigin::Exception,
    );
    if vm.is_shutting_down() {
        return Ok(());
    }
    vm.event_loop_mut().maybe_drain_microtasks()
}

// The full ~96-arm `match` (previously in this file) has been hoisted to
// `bun_runtime::dispatch::run_tasks` per §Dispatch hot-path — every arm names
// a `bun_runtime`/`bun_shell`/`bun_s3` type and so cannot compile at this tier.
// See git history of this file for the original draft.
