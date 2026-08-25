use crate::{JSGlobalObject, JSInternalPromise, JsError, JsResult};
use bun_core::StringView;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for JSC's JSModuleLoader.
    pub struct JSModuleLoader;
}

unsafe extern "C" {
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); `Option<&StringView>` is ABI-identical
    // to a nullable `*const BunString` via the guaranteed null-pointer optimization.
    // The returned `*mut JSInternalPromise` is nullable; callers check before deref.
    safe fn JSC__JSModuleLoader__loadAndEvaluateModule(
        arg0: &JSGlobalObject,
        arg1: Option<&StringView<'_>>,
    ) -> *mut JSInternalPromise;

    // safe: same handle/reference contract as `loadAndEvaluateModule` above;
    // `arg1` is always non-null at every Rust call site.
    safe fn JSModuleLoader__import(
        arg0: &JSGlobalObject,
        arg1: &StringView<'_>,
    ) -> *mut JSInternalPromise;
}

impl JSModuleLoader {
    /// Raw-pointer variant of `load_and_evaluate_module`. Returns the FFI
    /// `*mut JSInternalPromise` directly so callers that need to store or pass
    /// a mutable cell pointer don't launder provenance through `&T -> *mut T`.
    pub fn load_and_evaluate_module_ptr(
        global_object: *mut JSGlobalObject,
        module_name: Option<StringView<'_>>,
    ) -> Option<core::ptr::NonNull<JSInternalPromise>> {
        // `JSGlobalObject` is an opaque ZST handle; `opaque_ref` is the
        // centralised zero-byte deref proof (panics on null).
        core::ptr::NonNull::new(JSC__JSModuleLoader__loadAndEvaluateModule(
            JSGlobalObject::opaque_ref(global_object),
            module_name.as_ref(),
        ))
    }

    /// Raw-pointer variant of `Self::import`. Returns the FFI
    /// `*mut JSInternalPromise` directly so callers that need to store or pass
    /// a mutable cell pointer (e.g. `VirtualMachine::pending_internal_promise`)
    /// don't launder provenance through `&T -> *mut T`. Mirrors
    /// [`Self::load_and_evaluate_module_ptr`].
    pub fn import_ptr(
        global_object: *mut JSGlobalObject,
        module_name: StringView<'_>,
    ) -> JsResult<core::ptr::NonNull<JSInternalPromise>> {
        // `JSGlobalObject` is an opaque ZST handle; `opaque_ref` is the
        // centralised zero-byte deref proof (panics on null).
        core::ptr::NonNull::new(JSModuleLoader__import(
            JSGlobalObject::opaque_ref(global_object),
            &module_name,
        ))
        .ok_or(JsError::Thrown)
    }
}
