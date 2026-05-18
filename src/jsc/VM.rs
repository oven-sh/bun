use core::cell::UnsafeCell;
use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use crate::{Exception, ExceptionValidationScope, JSGlobalObject, JSValue, JsError};

// TODO(port): move to <jsc>_sys
//
// All JSC__VM__* shims take only a `JSC::VM*` (and at most a
// `JSGlobalObject*` / `JSC::Exception*` / scalar). `VM` and `JSGlobalObject`
// are opaque `UnsafeCell`-backed ZST handles, so `&VM` is ABI-identical to a
// non-null `VM*` and the C++ side mutating through it does not violate Rust
// aliasing (interior mutability; zero Rust-visible bytes). Declaring the
// params as references and the fns as `safe fn` moves the validity proof into
// the type signature and removes the per-call-site `unsafe { }` wrappers.
// `holdAPILock` keeps a raw `*mut c_void` ctx (opaque round-trip; C++ never
// dereferences it as Rust data) so it stays `unsafe fn`.
unsafe extern "C" {
    safe fn JSC__VM__deinit(vm: &VM, global_object: &JSGlobalObject);
    safe fn JSC__VM__setControlFlowProfiler(vm: &VM, enabled: bool);
    safe fn JSC__VM__hasExecutionTimeLimit(vm: &VM) -> bool;
    // safe: `VM` is an opaque `UnsafeCell`-backed ZST handle (`&` is ABI-identical
    // to non-null `*const`); `ctx` is an opaque round-trip pointer C++ only forwards
    // to `callback` (never dereferenced as Rust data) — same contract as
    // `JSC__JSGlobalObject__queueMicrotaskCallback`.
    safe fn JSC__VM__holdAPILock(
        this: &VM,
        ctx: *mut c_void,
        callback: extern "C" fn(ctx: *mut c_void),
    );
    safe fn JSC__VM__getAPILock(vm: &VM);
    safe fn JSC__VM__releaseAPILock(vm: &VM);
    safe fn JSC__VM__reportExtraMemory(vm: &VM, size: usize);
    safe fn JSC__VM__deleteAllCode(vm: &VM, global_object: &JSGlobalObject);
    safe fn JSC__VM__shrinkFootprint(vm: &VM);
    safe fn JSC__VM__runGC(vm: &VM, sync: bool) -> usize;
    safe fn JSC__VM__heapSize(vm: &VM) -> usize;
    safe fn JSC__VM__collectAsync(vm: &VM);
    safe fn JSC__VM__setExecutionForbidden(vm: &VM, forbidden: bool);
    safe fn JSC__VM__setExecutionTimeLimit(vm: &VM, timeout: f64);
    safe fn JSC__VM__clearExecutionTimeLimit(vm: &VM);
    safe fn JSC__VM__executionForbidden(vm: &VM) -> bool;
    safe fn JSC__VM__notifyNeedTermination(vm: &VM);
    safe fn JSC__VM__notifyNeedWatchdogCheck(vm: &VM);
    safe fn JSC__VM__notifyNeedDebuggerBreak(vm: &VM);
    safe fn JSC__VM__notifyNeedShellTimeoutCheck(vm: &VM);
    safe fn JSC__VM__isEntered(vm: &VM) -> bool;
    safe fn JSC__VM__throwError(vm: &VM, global_object: &JSGlobalObject, value: JSValue);
    safe fn JSC__VM__releaseWeakRefs(vm: &VM);
    safe fn JSC__VM__drainMicrotasks(vm: &VM);
    safe fn JSC__VM__externalMemorySize(vm: &VM) -> usize;
    safe fn JSC__VM__blockBytesAllocated(vm: &VM) -> usize;
    safe fn JSC__VM__performOpportunisticallyScheduledTasks(vm: &VM, until: f64);
}

bun_opaque::opaque_ffi! {
    /// Opaque handle to a `JSC::VM`.
    pub struct VM;
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum HeapType {
    SmallHeap = 0,
    LargeHeap = 1,
}

impl VM {
    // PORT NOTE: `JSC__VM__create` was removed from bindings.cpp (Bun creates
    // its VM via `Zig::GlobalObject::create` → `WebWorker__createVM` instead).
    // The Zig `VM.create` wrapper is dead code; do not port it.

    // PORT NOTE: not `impl Drop` — takes a `global_object` param and `VM` is an opaque FFI handle.
    pub fn deinit(&self, global_object: &JSGlobalObject) {
        JSC__VM__deinit(self, global_object)
    }

    pub fn set_control_flow_profiler(&self, enabled: bool) {
        JSC__VM__setControlFlowProfiler(self, enabled)
    }

    pub fn is_jit_enabled() -> bool {
        crate::cpp::JSC__VM__isJITEnabled()
    }

    pub fn has_execution_time_limit(&self) -> bool {
        JSC__VM__hasExecutionTimeLimit(self)
    }

    /// deprecated in favor of `get_api_lock` to avoid an annoying callback wrapper
    #[deprecated = "use get_api_lock"]
    pub fn hold_api_lock(&self, ctx: *mut c_void, callback: extern "C" fn(ctx: *mut c_void)) {
        JSC__VM__holdAPILock(self, ctx, callback)
    }

    /// See `JSLock.h` in WebKit for more detail on how the API lock prevents races.
    pub fn get_api_lock(&self) -> Lock<'_> {
        JSC__VM__getAPILock(self);
        Lock { vm: self }
    }

    // PORT NOTE: `JSC__VM__deferGC` was removed from bindings.cpp in the
    // WebKit-bump that introduced `JSC::DeferGC` RAII; the Zig `deferGC`
    // wrapper is dead code. Callers should use `holdAPILock`/`DeferGC` on the
    // C++ side instead.

    pub fn report_extra_memory(&self, size: usize) {
        crate::mark_binding!();
        JSC__VM__reportExtraMemory(self, size)
    }

    /// Alias retained for parity with the Zig comment naming this the
    /// "deprecated" GC accounting hook (the underlying C++ is
    /// `Heap::deprecatedReportExtraMemory`). Forward to [`report_extra_memory`].
    #[inline]
    pub fn deprecated_report_extra_memory(&self, size: usize) {
        self.report_extra_memory(size);
    }

    pub fn delete_all_code(&self, global_object: &JSGlobalObject) {
        JSC__VM__deleteAllCode(self, global_object)
    }

    pub fn shrink_footprint(&self) {
        JSC__VM__shrinkFootprint(self)
    }

    pub fn run_gc(&self, sync: bool) -> usize {
        JSC__VM__runGC(self, sync)
    }

    pub fn heap_size(&self) -> usize {
        JSC__VM__heapSize(self)
    }

    pub fn collect_async(&self) {
        JSC__VM__collectAsync(self)
    }

    pub fn set_execution_forbidden(&self, forbidden: bool) {
        JSC__VM__setExecutionForbidden(self, forbidden)
    }

    pub fn set_execution_time_limit(&self, timeout: f64) {
        JSC__VM__setExecutionTimeLimit(self, timeout)
    }

    pub fn clear_execution_time_limit(&self) {
        JSC__VM__clearExecutionTimeLimit(self)
    }

    pub fn execution_forbidden(&self) -> bool {
        JSC__VM__executionForbidden(self)
    }

    // These four functions fire VM traps. To understand what that means, see VMTraps.h for a giant explainer.
    // These may be called concurrently from another thread.

    /// Fires NeedTermination Trap. Thread safe. See jsc's "VMTraps.h" for explaination on traps.
    pub fn notify_need_termination(&self) {
        JSC__VM__notifyNeedTermination(self)
    }

    /// Fires NeedWatchdogCheck Trap. Thread safe. See jsc's "VMTraps.h" for explaination on traps.
    pub fn notify_need_watchdog_check(&self) {
        JSC__VM__notifyNeedWatchdogCheck(self)
    }

    /// Fires NeedDebuggerBreak Trap. Thread safe. See jsc's "VMTraps.h" for explaination on traps.
    pub fn notify_need_debugger_break(&self) {
        JSC__VM__notifyNeedDebuggerBreak(self)
    }

    /// Fires NeedShellTimeoutCheck Trap. Thread safe. See jsc's "VMTraps.h" for explaination on traps.
    pub fn notify_need_shell_timeout_check(&self) {
        JSC__VM__notifyNeedShellTimeoutCheck(self)
    }

    pub fn is_entered(&self) -> bool {
        JSC__VM__isEntered(self)
    }

    pub fn is_termination_exception(&self, exception: &Exception) -> bool {
        crate::cpp::JSC__VM__isTerminationException(self, exception)
    }

    pub fn has_termination_request(&self) -> bool {
        crate::cpp::JSC__VM__hasTerminationRequest(self)
    }

    pub fn clear_has_termination_request(&self) {
        crate::cpp::JSC__VM__clearHasTerminationRequest(self)
    }

    #[track_caller]
    pub fn throw_error(&self, global_object: &JSGlobalObject, value: JSValue) -> JsError {
        crate::validation_scope!(scope, global_object);
        scope.assert_no_exception();
        JSC__VM__throwError(self, global_object, value);
        scope.assert_exception_presence_matches(true);
        JsError::Thrown
    }

    pub fn release_weak_refs(&self) {
        JSC__VM__releaseWeakRefs(self)
    }

    pub fn drain_microtasks(&self) {
        JSC__VM__drainMicrotasks(self)
    }

    pub fn external_memory_size(&self) -> usize {
        JSC__VM__externalMemorySize(self)
    }

    /// `RESOURCE_USAGE` build option in JavaScriptCore is required for this function
    /// This is faster than checking the heap size
    pub fn block_bytes_allocated(&self) -> usize {
        JSC__VM__blockBytesAllocated(self)
    }

    pub fn perform_opportunistically_scheduled_tasks(&self, until: f64) {
        JSC__VM__performOpportunisticallyScheduledTasks(self, until)
    }
}

/// RAII JSLockHolder returned by [`VM::get_api_lock`]. Mirrors Zig
/// `JSC.VM.Lock` (`defer api_lock.release()` → `Drop`).
pub struct Lock<'a> {
    vm: &'a VM,
}

impl<'a> Lock<'a> {
    /// Explicit release (Zig spelling). Equivalent to `drop(self)`.
    #[inline]
    pub fn release(self) {}
}

impl Drop for Lock<'_> {
    fn drop(&mut self) {
        JSC__VM__releaseAPILock(self.vm)
    }
}

// ported from: src/jsc/VM.zig
