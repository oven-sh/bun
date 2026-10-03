use crate::{JSGlobalObject, JSInternalPromise, JsError, JsResult};
use bun_core::String as BunString;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for JSC's JSModuleLoader.
    pub struct JSModuleLoader;
}

unsafe extern "C" {
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`), and so is `&BunString`.
    // The returned `*mut JSInternalPromise` is nullable; callers check before deref.
    safe fn JSC__JSModuleLoader__loadAndEvaluateModule(
        arg0: &JSGlobalObject,
        arg1: &BunString,
    ) -> *mut JSInternalPromise;
    safe fn JSC__JSModuleLoader__resolveAndLoadAndEvaluateModule(
        arg0: &JSGlobalObject,
        arg1: &BunString,
    ) -> *mut JSInternalPromise;

    // safe: same handle/reference contract as above.
    safe fn JSModuleLoader__import(
        arg0: &JSGlobalObject,
        arg1: &BunString,
    ) -> *mut JSInternalPromise;
}

impl JSModuleLoader {
    /// `JSC::loadAndEvaluateModule`, which takes a key: what is resolved already. Returns the FFI
    /// `*mut JSInternalPromise` directly so callers that need to store or pass
    /// a mutable cell pointer don't launder provenance through `&T -> *mut T`.
    pub fn load_and_evaluate_module_ptr(
        global_object: *mut JSGlobalObject,
        key: &BunString,
    ) -> Option<core::ptr::NonNull<JSInternalPromise>> {
        // `JSGlobalObject` is an opaque ZST handle; `opaque_ref` is the
        // centralised zero-byte deref proof (panics on null).
        core::ptr::NonNull::new(JSC__JSModuleLoader__loadAndEvaluateModule(
            JSGlobalObject::opaque_ref(global_object),
            key,
        ))
    }

    /// `JSModuleLoader::resolve` with no importer, then [`Self::load_and_evaluate_module_ptr`]
    /// of the key. `None`, with the exception pending, if it does not resolve either.
    pub fn resolve_and_load_and_evaluate_module_ptr(
        global_object: *mut JSGlobalObject,
        module_name: &BunString,
    ) -> Option<core::ptr::NonNull<JSInternalPromise>> {
        // `JSGlobalObject` is an opaque ZST handle; `opaque_ref` is the
        // centralised zero-byte deref proof (panics on null).
        core::ptr::NonNull::new(JSC__JSModuleLoader__resolveAndLoadAndEvaluateModule(
            JSGlobalObject::opaque_ref(global_object),
            module_name,
        ))
    }

    /// Raw-pointer variant of `Self::import`. Returns the FFI
    /// `*mut JSInternalPromise` directly so callers that need to store or pass
    /// a mutable cell pointer (e.g. `VirtualMachine::pending_internal_promise`)
    /// don't launder provenance through `&T -> *mut T`. Mirrors
    /// [`Self::load_and_evaluate_module_ptr`].
    pub fn import_ptr(
        global_object: *mut JSGlobalObject,
        module_name: &BunString,
    ) -> JsResult<core::ptr::NonNull<JSInternalPromise>> {
        // `JSGlobalObject` is an opaque ZST handle; `opaque_ref` is the
        // centralised zero-byte deref proof (panics on null).
        core::ptr::NonNull::new(JSModuleLoader__import(
            JSGlobalObject::opaque_ref(global_object),
            module_name,
        ))
        .ok_or(JsError::Thrown)
    }
}
