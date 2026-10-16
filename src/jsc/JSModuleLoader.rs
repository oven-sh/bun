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
    safe fn JSC__JSModuleLoader__resolve(arg0: &JSGlobalObject, arg1: &BunString) -> BunString;
    safe fn JSC__JSModuleLoader__loadModule(
        arg0: &JSGlobalObject,
        arg1: &BunString,
    ) -> *mut JSInternalPromise;
    safe fn JSC__JSModuleLoader__linkAndEvaluateModule(
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

    /// `JSModuleLoader::resolve` with no importer: the key of the module `module_name` names.
    pub(crate) fn resolve(
        global_object: &JSGlobalObject,
        module_name: &BunString,
    ) -> JsResult<BunString> {
        crate::call_check_slow(global_object, || {
            JSC__JSModuleLoader__resolve(global_object, module_name)
        })
    }

    /// `JSC::loadModule`: fetches the graph of `key` without linking or evaluating it. `None` if the load could not start.
    pub(crate) fn load_module_ptr(
        global_object: *mut JSGlobalObject,
        key: &BunString,
    ) -> Option<core::ptr::NonNull<JSInternalPromise>> {
        core::ptr::NonNull::new(JSC__JSModuleLoader__loadModule(
            JSGlobalObject::opaque_ref(global_object),
            key,
        ))
    }

    /// `JSC::linkAndEvaluateModule`: links and evaluates, in this call, the graph that [`Self::load_module_ptr`] loaded.
    pub(crate) fn link_and_evaluate_module_ptr(
        global_object: &JSGlobalObject,
        key: &BunString,
    ) -> JsResult<core::ptr::NonNull<JSInternalPromise>> {
        let promise = crate::call_check_slow(global_object, || {
            JSC__JSModuleLoader__linkAndEvaluateModule(global_object, key)
        })?;
        core::ptr::NonNull::new(promise).ok_or(JsError::Thrown)
    }
}
