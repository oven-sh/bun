//! `bun_jsc::Task` — the hoisted task-dispatch tag/ptr pair.
//!
//! Per `docs/PORTING.md` §Dispatch hot-path: this crate (low/mid tier) only
//! stores `{ tag: u8, ptr: *mut () }` and a one-shot hook; the per-tick
//! `match` over all ~96 variant types lives in `bun_runtime::dispatch`
//! (high tier — it owns every variant type). LLVM inlines the high-tier arms
//! exactly as the Zig `inline else` did; this layer never names a variant.
//!
//! To add a new task to the queue:
//! 1. Add a tag constant to `bun_event_loop::task_tag` (the canonical list).
//! 2. `impl bun_jsc::Taskable for YourType { const TAG = task_tag::YourType; }`
//!    in the crate that owns `YourType`.
//! 3. Add a match arm in `bun_runtime::dispatch::run_tasks`.

use crate::event_loop::JsTerminated;
use crate::{JSGlobalObject, JsError};

pub use bun_event_loop::{Task, TaskTag, Taskable, task_tag};

#[inline]
pub fn new<T: Taskable>(ptr: *mut T) -> Task {
    Task::init(ptr)
}

/// Shared helper for the high-tier match arms that bubble `JsError` out of a
/// task body: report the uncaught exception, or convert termination into the
/// `JsTerminated` sentinel that unwinds the tick loop.
#[cold]
pub fn report_error_or_terminate(
    global: &JSGlobalObject,
    proof: JsError,
) -> Result<(), JsTerminated> {
    if proof == JsError::Terminated {
        return Err(JsTerminated::JSTerminated);
    }
    let ex = global.take_exception(proof);
    if ex.is_termination_exception() {
        return Err(JsTerminated::JSTerminated);
    }
    // TODO(port): `global.report_uncaught_exception(ex.as_exception(vm))` —
    // `JSValue::as_exception` / `JSGlobalObject::report_uncaught_exception`
    // surface lands when JSGlobalObject.rs un-gates.
    let _ = (global, ex);
    Ok(())
}

// ported from: src/jsc/Task.zig
