//! `node:perf_hooks` native binding — event loop idle/active time for
//! `performance.eventLoopUtilization()` and `performance.nodeTiming`.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

/// Returns `[idleMs, activeMs]` for this thread's event loop, both cumulative
/// since the loop started, or `undefined` if the loop has not started yet.
pub(crate) fn event_loop_utilization_values(
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let event_loop = global.bun_vm().event_loop();
    // SAFETY: `event_loop` is the live per-thread event loop owned by the VM.
    let Some(loop_) = (unsafe { (*event_loop).usockets_loop_opt() }) else {
        return Ok(JSValue::UNDEFINED);
    };
    // SAFETY: `loop_` is the live per-thread uws loop.
    let elapsed_ns = unsafe { (*loop_).elapsed_time_ns() };
    if elapsed_ns <= 0 {
        return Ok(JSValue::UNDEFINED);
    }
    // SAFETY: `loop_` is the live per-thread uws loop.
    let idle_ns = unsafe { (*loop_).idle_time_ns() };
    let active_ns = (elapsed_ns - idle_ns).max(0);
    const NS_PER_MS: f64 = 1_000_000.0;
    JSValue::create_array_from_slice(
        global,
        &[
            JSValue::from(idle_ns as f64 / NS_PER_MS),
            JSValue::from(active_ns as f64 / NS_PER_MS),
        ],
    )
}
