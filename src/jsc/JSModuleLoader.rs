use core::ptr::NonNull;

use crate::{JSGlobalObject, JSInternalPromise, JsError, JsResult};
use bun_core::String as BunString;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for JSC's JSModuleLoader.
    pub struct JSModuleLoader;
}

unsafe extern "C" {
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); `Option<&BunString>` is ABI-identical
    // to a nullable `*const BunString` via the guaranteed null-pointer optimization.
    // The returned `*mut JSInternalPromise` is nullable; callers check before deref.
    safe fn JSC__JSModuleLoader__loadAndEvaluateModule(
        arg0: &JSGlobalObject,
        arg1: Option<&BunString>,
    ) -> *mut JSInternalPromise;

    // safe: same handle/reference contract as `loadAndEvaluateModule` above;
    // `arg1` is always non-null at every Rust call site.
    safe fn JSModuleLoader__import(
        arg0: &JSGlobalObject,
        arg1: &BunString,
    ) -> *mut JSInternalPromise;
}

impl JSModuleLoader {
    /// Raw-pointer variant of `load_and_evaluate_module`. Returns the FFI
    /// `*mut JSInternalPromise` directly so callers that need to store or pass
    /// a mutable cell pointer don't launder provenance through `&T -> *mut T`.
    /// A failed load is a rejected promise; `None` only on VM termination.
    pub fn load_and_evaluate_module_ptr(
        global_object: *mut JSGlobalObject,
        module_name: Option<&BunString>,
    ) -> Option<NonNull<JSInternalPromise>> {
        // `JSGlobalObject` is an opaque ZST handle; `opaque_ref` is the
        // centralised zero-byte deref proof (panics on null).
        let global = JSGlobalObject::opaque_ref(global_object);
        NonNull::new(JSC__JSModuleLoader__loadAndEvaluateModule(
            global,
            module_name,
        ))
        .or_else(|| Self::reject_with_thrown_exception(global))
    }

    /// Raw-pointer variant of `Self::import`. Returns the FFI
    /// `*mut JSInternalPromise` directly so callers that need to store or pass
    /// a mutable cell pointer (e.g. `VirtualMachine::pending_internal_promise`)
    /// don't launder provenance through `&T -> *mut T`. Mirrors
    /// [`Self::load_and_evaluate_module_ptr`]; `Err` only on VM termination.
    pub fn import_ptr(
        global_object: *mut JSGlobalObject,
        module_name: &BunString,
    ) -> JsResult<NonNull<JSInternalPromise>> {
        // `JSGlobalObject` is an opaque ZST handle; `opaque_ref` is the
        // centralised zero-byte deref proof (panics on null).
        let global = JSGlobalObject::opaque_ref(global_object);
        NonNull::new(JSModuleLoader__import(global, module_name))
            .or_else(|| Self::reject_with_thrown_exception(global))
            .ok_or(JsError::Thrown)
    }

    /// JSC resolves the specifier before it has a promise to reject (Completion.cpp
    /// `loadAndEvaluateModule`, JSModuleLoader.cpp `requestImportModule`), so that
    /// failure alone is thrown, and the binding returns null. Callers report load
    /// failures from the promise. Handled, like the loader's own promises: the
    /// caller reports it, not the rejection tracker.
    fn reject_with_thrown_exception(global: &JSGlobalObject) -> Option<NonNull<JSInternalPromise>> {
        let exception = global.try_take_exception()?;
        // Still pending (`try_take_exception` does not clear it); leave it to the caller.
        if exception.is_termination_exception() {
            return None;
        }
        let promise = JSInternalPromise::create(global);
        promise
            .reject_as_handled(global, exception.to_error().unwrap_or(exception))
            .ok()?;
        Some(NonNull::from(promise))
    }
}
