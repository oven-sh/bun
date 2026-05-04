use crate::{JSArrayIterator, JSGlobalObject, JSValue, JsResult};

/// Opaque FFI handle for `JSC::JSArray`. Always used behind a reference/pointer.
#[repr(C)]
pub struct JSArray {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    // TODO(@paperclover): this can throw
    fn JSArray__constructArray(global: *const JSGlobalObject, items: *const JSValue, len: usize) -> JSValue;
    fn JSArray__constructEmptyArray(global: *const JSGlobalObject, len: usize) -> JSValue;
}

impl JSArray {
    #[track_caller]
    pub fn create(global: &JSGlobalObject, items: &[JSValue]) -> JsResult<JSValue> {
        // TODO(port): `fromJSHostCall(global, @src(), fn, .{args})` is a comptime-reflection
        // wrapper that calls `fn(args...)` then checks the VM for a pending exception.
        // Model it as a closure-taking helper here; Phase B may turn this into a macro.
        crate::from_js_host_call(global, || unsafe {
            // SAFETY: items.ptr/len are a valid contiguous slice; global is a live &JSGlobalObject.
            JSArray__constructArray(global, items.as_ptr(), items.len())
        })
    }

    #[track_caller]
    pub fn create_empty(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
        crate::from_js_host_call(global, || unsafe {
            // SAFETY: global is a live &JSGlobalObject.
            JSArray__constructEmptyArray(global, len)
        })
    }

    pub fn iterator(&self, global: &JSGlobalObject) -> JsResult<JSArrayIterator> {
        JSValue::from_cell(self).array_iterator(global)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSArray.zig (25 lines)
//   confidence: medium
//   todos:      2
//   notes:      from_js_host_call modeled as closure helper (Zig used anytype tuple + @src()); externs left inline pending jsc_sys split
// ──────────────────────────────────────────────────────────────────────────
