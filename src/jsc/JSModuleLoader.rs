use crate::{JSGlobalObject, JSInternalPromise, JSValue, JsError, JsResult};
use bun_str::String as BunString;

/// Opaque FFI handle for JSC's JSModuleLoader.
#[repr(C)]
pub struct JSModuleLoader {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__JSModuleLoader__evaluate(
        globalObject: *mut JSGlobalObject,
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
        arg0: *mut JSGlobalObject,
        arg1: *const BunString,
    ) -> *mut JSInternalPromise;

    fn JSModuleLoader__import(
        arg0: *mut JSGlobalObject,
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
        unsafe {
            JSC__JSModuleLoader__evaluate(
                global_object as *const _ as *mut _,
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
        // JSInternalPromise cell pointer owned by the JSC heap.
        unsafe {
            JSC__JSModuleLoader__loadAndEvaluateModule(
                global_object as *const _ as *mut _,
                module_name.map_or(core::ptr::null(), |p| p as *const _),
            )
            .as_ref()
        }
    }

    pub fn import<'a>(
        global_object: &'a JSGlobalObject,
        module_name: &BunString,
    ) -> JsResult<&'a JSInternalPromise> {
        // SAFETY: C++ side returns null iff an exception was thrown on the VM.
        unsafe {
            JSModuleLoader__import(
                global_object as *const _ as *mut _,
                module_name as *const _,
            )
            .as_ref()
        }
        .ok_or(JsError::Thrown)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSModuleLoader.zig (55 lines)
//   confidence: high
//   todos:      1
//   notes:      thin FFI wrappers; returned JSInternalPromise refs tied to global's lifetime as a placeholder
// ──────────────────────────────────────────────────────────────────────────
