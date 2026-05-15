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

// ─── Task / TaskTag / Taskable ───────────────────────────────────────────────
// The struct + tag table + type→tag trait are defined once in `bun_event_loop`
// (lowest tier on the hot-path list) and re-exported here so callers can write
// `bun_jsc::Task` / `bun_jsc::Taskable` without reaching down a tier.
pub use bun_event_loop::{Task, TaskTag, Taskable, task_tag};

/// `Task::new<T: Taskable>(ptr)` — typed constructor. Kept as a free fn for
/// back-compat with earlier Phase-A call sites; equivalent to [`Task::init`].
/// Zig: `Task.init(of: anytype)` derived the tag at comptime from `@TypeOf(of)`;
/// in Rust the tag comes from the [`Taskable`] impl.
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
    // TODO(b2): `global.report_uncaught_exception(ex.as_exception(vm))` —
    // `JSValue::as_exception` / `JSGlobalObject::report_uncaught_exception`
    // surface lands when JSGlobalObject.rs un-gates.
    let _ = (global, ex);
    Ok(())
}

// The Phase-A draft of the full ~96-arm `match` (previously in this file) has
// been hoisted to `bun_runtime::dispatch::run_tasks` per §Dispatch hot-path —
// every arm names a `bun_runtime`/`bun_shell`/`bun_s3` type and so cannot
// compile at this tier. See git history of this file for the verbatim draft.

// ported from: src/jsc/Task.zig
