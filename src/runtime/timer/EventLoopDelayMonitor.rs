use bun_jsc::JSValue;
use bun_jsc::virtual_machine::VirtualMachine;

use super::EventLoopDelayMonitor;

// Export functions for C++
#[unsafe(no_mangle)]
pub(super) extern "C" fn Timer_enableEventLoopDelayMonitoring(
    vm: *mut VirtualMachine,
    histogram: JSValue,
    resolution_ms: i32,
) -> *mut EventLoopDelayMonitor {
    // SAFETY: vm is a valid non-null pointer passed from C++.
    let vm = unsafe { &mut *vm };
    let monitor = Box::into_raw(Box::<EventLoopDelayMonitor>::default());
    // SAFETY: `monitor` was just allocated; the raw pointer has full provenance
    // for the intrusive timer node that `enable()` inserts into `All.timers`.
    unsafe { (*monitor).enable(vm, histogram, resolution_ms) };
    monitor
}

/// # Safety
/// `monitor` must be a pointer previously returned from
/// `Timer_enableEventLoopDelayMonitoring` that has not yet been passed here.
#[unsafe(no_mangle)]
pub(super) unsafe extern "C" fn Timer_disableEventLoopDelayMonitoring(
    vm: *mut VirtualMachine,
    monitor: *mut EventLoopDelayMonitor,
) {
    // SAFETY: vm is a valid non-null pointer passed from C++.
    let vm = unsafe { &mut *vm };
    // SAFETY: per fn contract; remove the intrusive timer node before reclaim.
    unsafe { (*monitor).disable(vm) };
    // SAFETY: per fn contract; reclaim the allocation from `enable`.
    drop(unsafe { Box::from_raw(monitor) });
}
