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

use core::sync::atomic::{AtomicPtr, Ordering};

use crate::event_loop::{EventLoop, JsTerminated};
use crate::virtual_machine::VirtualMachine;
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

// ─── RUN_TASK_HOOK ───────────────────────────────────────────────────────────
// One-shot registration mirroring `event_loop::TICK_QUEUE_HOOK` (keystone C).
// `bun_runtime` writes the real `run_tasks` fn-ptr at init; until then, the
// fallback drains without dispatching (unit-test / tool builds with no
// runtime tier linked).

unsafe extern "Rust" {
    /// High-tier dispatcher: drain `el.tasks`, run each, drain microtasks per
    /// item, bump `*counter`. Defined `#[no_mangle]` in
    /// `bun_runtime::dispatch::tick_queue_with_count`. Link-time resolved.
    fn __bun_run_tasks(
        el: &mut EventLoop,
        vm: &mut VirtualMachine,
        counter: &mut u32,
    ) -> Result<(), JsTerminated>;
}

/// Dispatch via the link-time extern. Exposed for callers that hold
/// `&mut EventLoop` + `&mut VirtualMachine` separately.
// PERF(port): was inline switch — direct calls per arm in
// `bun_runtime::dispatch::run_tasks`.
#[inline]
pub fn run_tasks(
    el: &mut EventLoop,
    vm: &mut VirtualMachine,
    counter: &mut u32,
) -> Result<(), JsTerminated> {
    // SAFETY: `el`/`vm` are the live per-thread loop+VM (caller contract).
    unsafe { __bun_run_tasks(el, vm, counter) }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/Task.zig (679 lines)
//   confidence: high (struct + tag + hook); match hoisted to bun_runtime
//   todos:      1 (unify RUN_TASK_HOOK with event_loop::TICK_QUEUE_HOOK)
//   notes:      §Dispatch hot-path — low tier stores (tag,ptr), high tier
//               owns the match. Taskable trait replaces comptime type-list.
// ──────────────────────────────────────────────────────────────────────────
