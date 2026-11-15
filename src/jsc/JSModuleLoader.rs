use crate::bindgen::JsLocal;
use crate::{JSGlobalObject, JSPromise, JsError, JsResult};
use bun_core::String as BunString;

bun_opaque::sealed_handle! {
    /// Opaque FFI handle for JSC's JSModuleLoader.
    pub struct JSModuleLoader;
}

unsafe extern "C" {
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`), and so is `&BunString`.
    safe fn JSC__JSModuleLoader__loadAndEvaluateModule<'a>(
        arg0: &'a JSGlobalObject,
        arg1: &BunString,
    ) -> Option<&'a JSPromise>;
    safe fn JSC__JSModuleLoader__resolveAndLoadAndEvaluateModule<'a>(
        arg0: &'a JSGlobalObject,
        arg1: &BunString,
    ) -> Option<&'a JSPromise>;

    // safe: same handle/reference contract as above.
    safe fn JSModuleLoader__import<'a>(
        arg0: &'a JSGlobalObject,
        arg1: &BunString,
    ) -> Option<&'a JSPromise>;
}

impl JSModuleLoader {
    /// `JSC::loadAndEvaluateModule`, which takes a key: what is resolved already.
    pub fn load_and_evaluate_module<'a>(
        global_object: &'a JSGlobalObject,
        key: &BunString,
    ) -> Option<JsLocal<'a, JSPromise>> {
        JSC__JSModuleLoader__loadAndEvaluateModule(global_object, key)
            .map(|promise| promise.to_local(global_object))
    }

    /// `JSModuleLoader::resolve` with no importer, then [`Self::load_and_evaluate_module`]
    /// of the key. `None`, with the exception pending, if it does not resolve either.
    pub fn resolve_and_load_and_evaluate_module<'a>(
        global_object: &'a JSGlobalObject,
        module_name: &BunString,
    ) -> Option<JsLocal<'a, JSPromise>> {
        JSC__JSModuleLoader__resolveAndLoadAndEvaluateModule(global_object, module_name)
            .map(|promise| promise.to_local(global_object))
    }

    pub fn import<'a>(
        global_object: &'a JSGlobalObject,
        module_name: &BunString,
    ) -> JsResult<JsLocal<'a, JSPromise>> {
        JSModuleLoader__import(global_object, module_name)
            .map(|promise| promise.to_local(global_object))
            .ok_or(JsError::Thrown)
    }
}
