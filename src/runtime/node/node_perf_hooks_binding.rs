use bun_jsc::virtual_machine::VirtualMachine;

/// Backs `performance.eventLoopUtilization()` and `nodeTiming.idleTime` /
/// `nodeTiming.loopStart` in `node:perf_hooks`. Fills the calling VM's
/// event-loop uptime and its cumulative I/O-poll idle time, in milliseconds,
/// both from the same monotonic clock so `active = uptime - idle`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__getEventLoopIdleMetrics(
    vm: *mut VirtualMachine,
    uptime_ms: *mut f64,
    idle_ms: *mut f64,
) {
    // SAFETY: `vm` is `bunVM(globalObject)` passed by the JSC host function in
    // JSNodePerformanceHooksHistogramPrototype.cpp; the out-params are
    // addresses of two stack doubles that live for the call.
    let vm = unsafe { &*vm };
    let (uptime_ns, idle_ns) = vm.uws_loop_mut().idle_metrics();
    unsafe {
        *uptime_ms = uptime_ns as f64 / 1e6;
        *idle_ms = idle_ns as f64 / 1e6;
    }
}
