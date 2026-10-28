use crate::{JSGlobalObject, JSValue, JsResult};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `JSC::JSArray`. Always used behind a reference/pointer.
    pub struct JSArray;
}

unsafe extern "C" {
    safe fn JSArray__constructEmptyArray(global: &JSGlobalObject, len: usize) -> JSValue;
}

impl JSArray {
    #[track_caller]
    pub fn create_empty(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
        crate::from_js_host_call(global, || JSArray__constructEmptyArray(global, len))
    }
}
