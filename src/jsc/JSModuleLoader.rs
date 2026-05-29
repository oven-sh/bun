use crate::{JSGlobalObject, JSInternalPromise, JSValue, JsError, JsResult};
use bun_core::String as BunString;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for JSC's JSModuleLoader.
    pub struct JSModuleLoader;
}

unsafe extern "C" {
    fn JSC__JSModuleLoader__evaluate(
        globalObject: *const JSGlobalObject,
        sourceCodePtr: *const u8,
        sourceCodeLen: usize,
        originUrlPtr: *const u8,
        originUrlLen: usize,
        referrerUrlPtr: *const u8,
        referrerUrlLen: usize,
        thisValue: JSValue,
        exception: *mut JSValue,
    ) -> JSValue;

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
    pub fn evaluate(
        global_object: &JSGlobalObject,
        source_code: &[u8],
        origin_url: &[u8],
        referrer_url: &[u8],
        this_value: JSValue,
        exception: &mut JSValue,
    ) -> JSValue {
        // SAFETY: thin wrapper over C++ JSC__JSModuleLoader__evaluate; slice ptr/len pairs are
        // valid for reads for the duration of the FFI call and `exception` is a unique writable
        // JSValue slot. `global_object` is an opaque ZST handle — passed as `*const` per the FFI
        // convention in `JSGlobalObject.rs`; C++-side mutation is outside Rust's aliasing model.
        unsafe {
            JSC__JSModuleLoader__evaluate(
                global_object,
                source_code.as_ptr(),
                source_code.len(),
                origin_url.as_ptr(),
                origin_url.len(),
                referrer_url.as_ptr(),
                referrer_url.len(),
                this_value,
                exception,
            )
        }
    }

    pub fn load_and_evaluate_module<'a>(
        global_object: &'a JSGlobalObject,
        module_name: Option<&BunString>,
    ) -> Option<&'a JSInternalPromise> {
        // C++ returns a nullable JSInternalPromise cell pointer owned by the JSC
        // heap. `JSInternalPromise` is an opaque ZST handle so the deref is the
        // centralised `opaque_ref` proof.
        let p = JSC__JSModuleLoader__loadAndEvaluateModule(global_object, module_name);
        (!p.is_null()).then(|| JSInternalPromise::opaque_ref(p))
    }

    /// Raw-pointer variant of [`load_and_evaluate_module`]. Returns the FFI
    /// `*mut JSInternalPromise` directly so callers that need to store or pass
    /// a mutable cell pointer don't launder provenance through `&T -> *mut T`.
    pub fn load_and_evaluate_module_ptr(
        global_object: *mut JSGlobalObject,
        module_name: Option<&BunString>,
    ) -> Option<core::ptr::NonNull<JSInternalPromise>> {
        // `JSGlobalObject` is an opaque ZST handle; `opaque_ref` is the
        // centralised zero-byte deref proof (panics on null).
        core::ptr::NonNull::new(JSC__JSModuleLoader__loadAndEvaluateModule(
            JSGlobalObject::opaque_ref(global_object),
            module_name,
        ))
    }

    pub fn import<'a>(
        global_object: &'a JSGlobalObject,
        module_name: &BunString,
    ) -> JsResult<&'a JSInternalPromise> {
        // C++ returns null iff an exception was thrown on the VM.
        // `JSInternalPromise` is an opaque ZST handle so the deref is the
        // centralised `opaque_ref` proof.
        let p = JSModuleLoader__import(global_object, module_name);
        (!p.is_null())
            .then(|| JSInternalPromise::opaque_ref(p))
            .ok_or(JsError::Thrown)
    }

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

// ported from: src/jsc/JSModuleLoader.zig
