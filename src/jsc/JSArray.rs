use crate::{JSArrayIterator, JSGlobalObject, JSValue, JsResult};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `JSC::JSArray`. Always used behind a reference/pointer.
    pub struct JSArray;
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    // TODO(@paperclover): this can throw
    fn JSArray__constructArray(
        global: *const JSGlobalObject,
        items: *const JSValue,
        len: usize,
    ) -> JSValue;
    safe fn JSArray__constructEmptyArray(global: &JSGlobalObject, len: usize) -> JSValue;
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
        crate::from_js_host_call(global, || JSArray__constructEmptyArray(global, len))
    }

    pub fn iterator<'a>(&self, global: &'a JSGlobalObject) -> JsResult<JSArrayIterator<'a>> {
        JSValue::from_cell(self).array_iterator(global)
    }
}

// ported from: src/jsc/JSArray.zig
