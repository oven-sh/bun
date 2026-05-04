use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use crate::{Exception, ExceptionValidationScope, JSGlobalObject, JSValue, JsError};

// TODO(port): move to <jsc>_sys
unsafe extern "C" {
    fn JSC__VM__create(heap_type: u8) -> *mut VM;
    fn JSC__VM__deinit(vm: *mut VM, global_object: *mut JSGlobalObject);
    fn JSC__VM__setControlFlowProfiler(vm: *mut VM, enabled: bool);
    fn JSC__VM__isJITEnabled() -> bool;
    fn JSC__VM__hasExecutionTimeLimit(vm: *mut VM) -> bool;
    fn JSC__VM__holdAPILock(
        this: *mut VM,
        ctx: *mut c_void,
        callback: extern "C" fn(ctx: *mut c_void),
    );
    fn JSC__VM__getAPILock(vm: *mut VM);
    fn JSC__VM__releaseAPILock(vm: *mut VM);
    fn JSC__VM__deferGC(
        this: *mut VM,
        ctx: *mut c_void,
        callback: extern "C" fn(ctx: *mut c_void),
    );
    fn JSC__VM__reportExtraMemory(vm: *mut VM, size: usize);
    fn JSC__VM__deleteAllCode(vm: *mut VM, global_object: *mut JSGlobalObject);
    fn JSC__VM__shrinkFootprint(vm: *mut VM);
    fn JSC__VM__runGC(vm: *mut VM, sync: bool) -> usize;
    fn JSC__VM__heapSize(vm: *mut VM) -> usize;
    fn JSC__VM__collectAsync(vm: *mut VM);
    fn JSC__VM__setExecutionForbidden(vm: *mut VM, forbidden: bool);
    fn JSC__VM__setExecutionTimeLimit(vm: *mut VM, timeout: f64);
    fn JSC__VM__clearExecutionTimeLimit(vm: *mut VM);
    fn JSC__VM__executionForbidden(vm: *mut VM) -> bool;
    fn JSC__VM__notifyNeedTermination(vm: *mut VM);
    fn JSC__VM__notifyNeedWatchdogCheck(vm: *mut VM);
    fn JSC__VM__notifyNeedDebuggerBreak(vm: *mut VM);
    fn JSC__VM__notifyNeedShellTimeoutCheck(vm: *mut VM);
    fn JSC__VM__isEntered(vm: *mut VM) -> bool;
    fn JSC__VM__isTerminationException(vm: *mut VM, exception: *mut Exception) -> bool;
    fn JSC__VM__hasTerminationRequest(vm: *mut VM) -> bool;
    fn JSC__VM__clearHasTerminationRequest(vm: *mut VM);
    fn JSC__VM__throwError(vm: *mut VM, global_object: *mut JSGlobalObject, value: JSValue);
    fn JSC__VM__releaseWeakRefs(vm: *mut VM);
    fn JSC__VM__drainMicrotasks(vm: *mut VM);
    fn JSC__VM__externalMemorySize(vm: *mut VM) -> usize;
    fn JSC__VM__blockBytesAllocated(vm: *mut VM) -> usize;
    fn JSC__VM__performOpportunisticallyScheduledTasks(vm: *mut VM, until: f64);
}

/// Opaque handle to a `JSC::VM`.
#[repr(C)]
pub struct VM {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum HeapType {
    SmallHeap = 0,
    LargeHeap = 1,
}

impl VM {
    pub fn create(heap_type: HeapType) -> NonNull<VM> {
        // SAFETY: JSC__VM__create never returns null.
        unsafe { NonNull::new_unchecked(JSC__VM__create(heap_type as u8)) }
        // TODO(port): lifetime — returned VM is owned until `deinit`; consider a wrapper type
    }

    // PORT NOTE: not `impl Drop` — takes a `global_object` param and `VM` is an opaque FFI handle.
    pub fn deinit(&self, global_object: &JSGlobalObject) {
        // SAFETY: self and global_object are valid live JSC objects.
        unsafe { JSC__VM__deinit(self.as_mut_ptr(), global_object.as_mut_ptr()) }
    }

    pub fn set_control_flow_profiler(&self, enabled: bool) {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__setControlFlowProfiler(self.as_mut_ptr(), enabled) }
    }

    pub fn is_jit_enabled() -> bool {
        // SAFETY: pure query, no preconditions.
        unsafe { JSC__VM__isJITEnabled() }
    }

    pub fn has_execution_time_limit(&self) -> bool {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__hasExecutionTimeLimit(self.as_mut_ptr()) }
    }

    /// deprecated in favor of `get_api_lock` to avoid an annoying callback wrapper
    #[deprecated = "use get_api_lock"]
    pub fn hold_api_lock(&self, ctx: *mut c_void, callback: extern "C" fn(ctx: *mut c_void)) {
        // SAFETY: self is a valid VM; callback is a valid C fn pointer.
        unsafe { JSC__VM__holdAPILock(self.as_mut_ptr(), ctx, callback) }
    }

    /// See `JSLock.h` in WebKit for more detail on how the API lock prevents races.
    pub fn get_api_lock(&self) -> Lock<'_> {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__getAPILock(self.as_mut_ptr()) }
        Lock { vm: self }
    }

    pub fn defer_gc(&self, ctx: *mut c_void, callback: extern "C" fn(ctx: *mut c_void)) {
        // SAFETY: self is a valid VM; callback is a valid C fn pointer.
        unsafe { JSC__VM__deferGC(self.as_mut_ptr(), ctx, callback) }
    }

    pub fn deprecated_report_extra_memory(&self, size: usize) {
        // TODO(port): jsc.markBinding(@src()) — debug instrumentation
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__reportExtraMemory(self.as_mut_ptr(), size) }
    }

    pub fn delete_all_code(&self, global_object: &JSGlobalObject) {
        // SAFETY: self and global_object are valid live JSC objects.
        unsafe { JSC__VM__deleteAllCode(self.as_mut_ptr(), global_object.as_mut_ptr()) }
    }

    pub fn shrink_footprint(&self) {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__shrinkFootprint(self.as_mut_ptr()) }
    }

    pub fn run_gc(&self, sync: bool) -> usize {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__runGC(self.as_mut_ptr(), sync) }
    }

    pub fn heap_size(&self) -> usize {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__heapSize(self.as_mut_ptr()) }
    }

    pub fn collect_async(&self) {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__collectAsync(self.as_mut_ptr()) }
    }

    pub fn set_execution_forbidden(&self, forbidden: bool) {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__setExecutionForbidden(self.as_mut_ptr(), forbidden) }
    }

    pub fn set_execution_time_limit(&self, timeout: f64) {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__setExecutionTimeLimit(self.as_mut_ptr(), timeout) }
    }

    pub fn clear_execution_time_limit(&self) {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__clearExecutionTimeLimit(self.as_mut_ptr()) }
    }

    pub fn execution_forbidden(&self) -> bool {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__executionForbidden(self.as_mut_ptr()) }
    }

    // These four functions fire VM traps. To understand what that means, see VMTraps.h for a giant explainer.
    // These may be called concurrently from another thread.

    /// Fires NeedTermination Trap. Thread safe. See jsc's "VMTraps.h" for explaination on traps.
    pub fn notify_need_termination(&self) {
        // SAFETY: self is a valid VM; documented thread-safe on the C++ side.
        unsafe { JSC__VM__notifyNeedTermination(self.as_mut_ptr()) }
    }

    /// Fires NeedWatchdogCheck Trap. Thread safe. See jsc's "VMTraps.h" for explaination on traps.
    pub fn notify_need_watchdog_check(&self) {
        // SAFETY: self is a valid VM; documented thread-safe on the C++ side.
        unsafe { JSC__VM__notifyNeedWatchdogCheck(self.as_mut_ptr()) }
    }

    /// Fires NeedDebuggerBreak Trap. Thread safe. See jsc's "VMTraps.h" for explaination on traps.
    pub fn notify_need_debugger_break(&self) {
        // SAFETY: self is a valid VM; documented thread-safe on the C++ side.
        unsafe { JSC__VM__notifyNeedDebuggerBreak(self.as_mut_ptr()) }
    }

    /// Fires NeedShellTimeoutCheck Trap. Thread safe. See jsc's "VMTraps.h" for explaination on traps.
    pub fn notify_need_shell_timeout_check(&self) {
        // SAFETY: self is a valid VM; documented thread-safe on the C++ side.
        unsafe { JSC__VM__notifyNeedShellTimeoutCheck(self.as_mut_ptr()) }
    }

    pub fn is_entered(&self) -> bool {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__isEntered(self.as_mut_ptr()) }
    }

    pub fn is_termination_exception(&self, exception: &Exception) -> bool {
        // SAFETY: self and exception are valid live JSC objects.
        unsafe {
            JSC__VM__isTerminationException(
                self.as_mut_ptr(),
                exception as *const Exception as *mut Exception,
            )
        }
    }

    pub fn has_termination_request(&self) -> bool {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__hasTerminationRequest(self.as_mut_ptr()) }
    }

    pub fn clear_has_termination_request(&self) {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__clearHasTerminationRequest(self.as_mut_ptr()) }
    }

    pub fn throw_error(&self, global_object: &JSGlobalObject, value: JSValue) -> JsError {
        // TODO(port): ExceptionValidationScope::init takes @src() in Zig — needs source-location plumbing
        let scope = ExceptionValidationScope::init(global_object);
        scope.assert_no_exception();
        // SAFETY: self and global_object are valid; value is a live JSValue on this VM.
        unsafe { JSC__VM__throwError(self.as_mut_ptr(), global_object.as_mut_ptr(), value) }
        scope.assert_exception_presence_matches(true);
        // `defer scope.deinit()` → handled by Drop
        JsError::Thrown
    }

    pub fn release_weak_refs(&self) {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__releaseWeakRefs(self.as_mut_ptr()) }
    }

    pub fn drain_microtasks(&self) {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__drainMicrotasks(self.as_mut_ptr()) }
    }

    pub fn external_memory_size(&self) -> usize {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__externalMemorySize(self.as_mut_ptr()) }
    }

    /// `RESOURCE_USAGE` build option in JavaScriptCore is required for this function
    /// This is faster than checking the heap size
    pub fn block_bytes_allocated(&self) -> usize {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__blockBytesAllocated(self.as_mut_ptr()) }
    }

    pub fn perform_opportunistically_scheduled_tasks(&self, until: f64) {
        // SAFETY: self is a valid VM.
        unsafe { JSC__VM__performOpportunisticallyScheduledTasks(self.as_mut_ptr(), until) }
    }

    #[inline(always)]
    fn as_mut_ptr(&self) -> *mut VM {
        self as *const VM as *mut VM
    }
}

pub struct Lock<'a> {
    vm: &'a VM,
}

impl<'a> Lock<'a> {
    pub fn release(self) {
        // SAFETY: lock was acquired via JSC__VM__getAPILock on this VM.
        unsafe { JSC__VM__releaseAPILock(self.vm.as_mut_ptr()) }
    }
    // TODO(port): consider `impl Drop` for RAII release (Zig callers use `defer lock.release()`)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/VM.zig (210 lines)
//   confidence: medium
//   todos:      4
//   notes:      opaque FFI wrapper; `as_mut_ptr` helper added for &self→*mut; ExceptionValidationScope @src() & Lock RAII deferred to Phase B
// ──────────────────────────────────────────────────────────────────────────
