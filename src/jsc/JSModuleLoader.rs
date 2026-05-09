use crate::{JSGlobalObject, JSInternalPromise, JSValue, JsError, JsResult};
use bun_string::String as BunString;

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

    fn JSC__JSModuleLoader__loadAndEvaluateModule(
        arg0: *const JSGlobalObject,
        arg1: *const BunString,
    ) -> *mut JSInternalPromise;

    fn JSModuleLoader__import(
        arg0: *const JSGlobalObject,
        arg1: *const BunString,
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
        // SAFETY: C++ side accepts a nullable `const BunString*` and returns a nullable
        // JSInternalPromise cell pointer owned by the JSC heap. `global_object` is an
        // opaque ZST handle passed as `*const` per the FFI convention in `JSGlobalObject.rs`.
        unsafe {
            JSC__JSModuleLoader__loadAndEvaluateModule(
                global_object,
                module_name.map_or(core::ptr::null(), |p| std::ptr::from_ref(p)),
            )
            .as_ref()
        }
    }

    /// Raw-pointer variant of [`load_and_evaluate_module`]. Returns the FFI
    /// `*mut JSInternalPromise` directly so callers that need to store or pass
    /// a mutable cell pointer don't launder provenance through `&T -> *mut T`.
    pub fn load_and_evaluate_module_ptr(
        global_object: *mut JSGlobalObject,
        module_name: Option<&BunString>,
    ) -> Option<core::ptr::NonNull<JSInternalPromise>> {
        // SAFETY: C++ side accepts a nullable `const BunString*` and returns a
        // nullable JSInternalPromise cell pointer owned by the JSC heap.
        core::ptr::NonNull::new(unsafe {
            JSC__JSModuleLoader__loadAndEvaluateModule(
                global_object,
                module_name.map_or(core::ptr::null(), |p| std::ptr::from_ref(p)),
            )
        })
    }

    pub fn import<'a>(
        global_object: &'a JSGlobalObject,
        module_name: &BunString,
    ) -> JsResult<&'a JSInternalPromise> {
        // SAFETY: C++ side returns null iff an exception was thrown on the VM.
        // `global_object` is an opaque ZST handle passed as `*const` per the FFI
        // convention in `JSGlobalObject.rs`.
        unsafe {
            JSModuleLoader__import(global_object, std::ptr::from_ref(module_name))
                .as_ref()
        }
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
        // SAFETY: C++ side returns null iff an exception was thrown on the VM.
        core::ptr::NonNull::new(unsafe {
            JSModuleLoader__import(global_object, std::ptr::from_ref(module_name))
        })
        .ok_or(JsError::Thrown)
    }
}

// ported from: src/jsc/JSModuleLoader.zig
