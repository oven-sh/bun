use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsError};

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
    safe fn JSC__VM__enableControlFlowProfiler(vm: &VM);
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
    safe fn JSC__VM__shrinkFootprint(vm: &VM);
    safe fn JSC__VM__runGC(vm: &VM, sync: bool) -> usize;
    safe fn JSC__VM__heapSize(vm: &VM) -> usize;
    safe fn JSC__VM__collectAsync(vm: &VM, full: bool);
    safe fn JSC__VM__collectAsyncIdle(vm: &VM);
    safe fn JSC__VM__executionForbidden(vm: &VM) -> bool;
    safe fn JSC__VM__notifyNeedTermination(vm: &VM);
    safe fn JSC__VM__isEntered(vm: &VM) -> bool;
    safe fn JSC__VM__terminationException(vm: &VM) -> JSValue;
    safe fn JSC__VM__throwError(vm: &VM, global_object: &JSGlobalObject, value: JSValue);
    safe fn JSC__VM__releaseWeakRefs(vm: &VM);
    safe fn JSC__VM__drainMicrotasks(vm: &VM);
    safe fn JSC__VM__blockBytesAllocated(vm: &VM) -> usize;
}

bun_opaque::opaque_ffi! {
    /// Opaque handle to a `JSC::VM`.
    pub struct VM;
}

impl VM {
    // Note: `JSC__VM__create` was removed from bindings.cpp (Bun creates
    // its VM via `Zig::GlobalObject::create` → `WebWorker__createVM` instead).

    // Note: not `impl Drop` — takes a `global_object` param and `VM` is an opaque FFI handle.

    pub fn enable_control_flow_profiler(&self) {
        JSC__VM__enableControlFlowProfiler(self)
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

    // Note: `JSC__VM__deferGC` was removed from bindings.cpp in the
    // WebKit-bump that introduced `JSC::DeferGC` RAII. Callers should use
    // `holdAPILock`/`DeferGC` on the C++ side instead.

    pub fn report_extra_memory(&self, size: usize) {
        crate::mark_binding!();
        JSC__VM__reportExtraMemory(self, size)
    }

    /// Alias for the "deprecated" GC accounting hook (the underlying C++ is
    /// `Heap::deprecatedReportExtraMemory`). Forwards to [`report_extra_memory`].
    #[inline]
    pub fn deprecated_report_extra_memory(&self, size: usize) {
        self.report_extra_memory(size);
    }

    pub fn shrink_footprint(&self) {
        JSC__VM__shrinkFootprint(self)
    }

    pub fn run_gc(&self, sync: bool) -> usize {
        JSC__VM__runGC(self, sync)
    }

    pub(crate) fn heap_size(&self) -> usize {
        JSC__VM__heapSize(self)
    }

    /// Request a concurrent collection; JSC picks the scope unless `full`.
    pub(crate) fn collect_async(&self, full: bool) {
        JSC__VM__collectAsync(self, full)
    }

    /// A full collection tagged as the embedder's idle collection, in which JSC may also let idle optimized code go.
    pub(crate) fn collect_async_idle(&self) {
        JSC__VM__collectAsyncIdle(self)
    }

    pub fn execution_forbidden(&self) -> bool {
        JSC__VM__executionForbidden(self)
    }

    // These four functions fire VM traps. To understand what that means, see VMTraps.h for a giant explainer.
    // These may be called concurrently from another thread.

    /// Fires NeedTermination Trap. Thread safe. See jsc's "VMTraps.h" for explaination on traps.
    pub(crate) fn notify_need_termination(&self) {
        JSC__VM__notifyNeedTermination(self)
    }

    /// A script frame is on this VM's stack (JSC::VM::isEntered — a VMEntryScope is live).
    pub fn is_entered(&self) -> bool {
        JSC__VM__isEntered(self)
    }

    /// The VM's TerminationException cell (created on demand) — what a pending one reads as; inert
    /// until thrown.
    pub fn termination_exception(&self) -> JSValue {
        JSC__VM__terminationException(self)
    }

    /// Has termination been requested on this VM (worker.terminate(), or
    /// teardown's forbidExecution)? JS thread.
    pub fn has_termination_request(&self) -> bool {
        crate::cpp::JSC__VM__hasTerminationRequest(self)
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

    /// `RESOURCE_USAGE` build option in JavaScriptCore is required for this function
    /// This is faster than checking the heap size
    pub(crate) fn block_bytes_allocated(&self) -> usize {
        JSC__VM__blockBytesAllocated(self)
    }
}

/// RAII JSLockHolder returned by [`VM::get_api_lock`]. Released on `Drop`.
pub struct Lock<'a> {
    vm: &'a VM,
}

impl Drop for Lock<'_> {
    fn drop(&mut self) {
        JSC__VM__releaseAPILock(self.vm)
    }
}
