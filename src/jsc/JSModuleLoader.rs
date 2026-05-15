use crate::{JSGlobalObject, JSInternalPromise, JSValue, JsError, JsResult};
use bun_core::String as BunString;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for JSC's JSModuleLoader.
    pub struct JSModuleLoader;
}

// TODO(port): move to jsc_sys
//
// `JSGlobalObject` is an opaque ZST handle on the Rust side; Rust never reads or
// writes bytes through it. C++ mutates VM state internally, but that is outside
// Rust's aliasing model, so these externs take `*const JSGlobalObject` (matching
// the convention in `JSGlobalObject.rs`) rather than forcing callers to launder
// `&JSGlobalObject` through a `*const _ as *mut _` cast.
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
    pub fn evaluate(
        global_object: &JSGlobalObject,
        source_code_ptr: *const u8,
        source_code_len: usize,
        origin_url_ptr: *const u8,
        origin_url_len: usize,
        referrer_url_ptr: *const u8,
        referrer_url_len: usize,
        this_value: JSValue,
        exception: *mut JSValue,
    ) -> JSValue {
        // SAFETY: thin wrapper over C++ JSC__JSModuleLoader__evaluate; caller guarantees
        // ptr/len pairs are valid for reads and `exception` points to a writable JSValue slot.
        // `global_object` is an opaque ZST handle — passed as `*const` per the FFI convention
        // in `JSGlobalObject.rs`; C++-side mutation is outside Rust's aliasing model.
        unsafe {
            JSC__JSModuleLoader__evaluate(
                global_object,
                source_code_ptr,
                source_code_len,
                origin_url_ptr,
                origin_url_len,
                referrer_url_ptr,
                referrer_url_len,
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

    /// Raw-pointer variant of [`Self::import`]. Returns the FFI
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

// ported from: src/jsc/JSModuleLoader.zig
