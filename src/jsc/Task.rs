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
//! 3. Add a match arm in `bun_runtime::dispatch::run_tasks`.

use crate::event_loop::Stopped;
use crate::{JSGlobalObject, JsError};

// ─── Task / TaskTag / Taskable ───────────────────────────────────────────────
// The struct + tag table + type→tag trait are defined once in `bun_event_loop`
// (lowest tier on the hot-path list) and re-exported here so callers can write
// `bun_jsc::Task` / `bun_jsc::Taskable` without reaching down a tier.
pub use bun_event_loop::{Task, TaskTag, Taskable, task_tag};

/// `Task::new<T: Taskable>(ptr)` — typed constructor. Kept as a free fn for
/// back-compat with existing call sites; equivalent to [`Task::init`].
/// The tag comes from the [`Taskable`] impl.
#[inline]
pub fn new<T: Taskable>(ptr: *mut T) -> Task {
    Task::init(ptr)
}

// ─── run_tasks dispatch ─────────────────────────────────────────────────────
// The per-tick dispatch entry point is `bun_jsc::event_loop::tick_queue_with_
// count` (declares `__bun_tick_queue_with_count`, defined in
// `bun_runtime::dispatch`). The former duplicate `__bun_run_tasks` extern +
// `pub fn run_tasks` wrapper here had no callers and aliased the same body —
// deleted r6 (one symbol per dispatch entry, per PORTING.md §extern-Rust-ban).

/// The fold at a loop entry that ran a task's JS: report the uncaught exception, or -- if what came
/// back is the VM's termination -- stand the tick loop down (WebCore: `isTerminationException(returned)`).
#[cold]
pub fn report_error_or_terminate(global: &JSGlobalObject, proof: JsError) -> Result<(), Stopped> {
    fold_inner(global, proof)
}

/// [`report_error_or_terminate`] for a fold that runs outside any event-loop
/// scope (a foreign dispatcher's trampoline: uSockets, timers, pipe I/O): the
/// scopes beneath it skipped their microtask checkpoint over the pending
/// exception (`EventLoop::exit`), so run it here once the exception is taken.
#[cold]
pub fn fold_at_loop_entry(global: &JSGlobalObject, proof: JsError) -> Result<(), Stopped> {
    fold_inner(global, proof)?;
    global.bun_vm().event_loop_mut().drain_microtasks()
}

#[inline]
fn fold_inner(global: &JSGlobalObject, proof: JsError) -> Result<(), Stopped> {
    let ex = global.take_exception(proof);
    if ex.is_termination_exception() {
        return Err(Stopped);
    }
    let vm = std::ptr::from_ref::<crate::VM>(global.vm()).cast_mut();
    let exc = ex
        .as_exception(vm)
        .expect("exception value must be an Exception cell");
    // `as_exception` returned a non-null cell pointer rooted on the VM;
    // `Exception` is an opaque ZST handle — safe deref (panics on null).
    let _ = crate::js_global_object::report_uncaught_exception(
        global,
        crate::Exception::opaque_ref(exc),
    );
    Ok(())
}

/// `bun_io::__bun_fold_loop_js_error` — the fold for the pipe reader/writer
/// trampolines, which sit below this tier. Loop level: `Stopped` has no one to
/// return to there (the tick reads the gate after the I/O phase).
#[unsafe(no_mangle)]
fn __bun_fold_loop_js_error(err: bun_core::JsError) {
    let global = crate::virtual_machine::VirtualMachine::get().global();
    let _ = fold_at_loop_entry(global, err.into());
}

// The full ~96-arm `match` (previously in this file) has been hoisted to
// `bun_runtime::dispatch::run_tasks` per §Dispatch hot-path — every arm names
// a `bun_runtime`/`bun_shell`/`bun_s3` type and so cannot compile at this tier.
// See git history of this file for the original draft.
