use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_core::ZigString;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to WebCore::DOMFormData (C++ side).
    pub struct DOMFormData;
}

unsafe extern "C" {
    safe fn WebCore__DOMFormData__create(arg0: &JSGlobalObject) -> JSValue;
    safe fn WebCore__DOMFormData__createFromURLQuery(
        arg0: &JSGlobalObject,
        arg1: &ZigString,
    ) -> JSValue;
    safe fn WebCore__DOMFormData__fromJS(js_value0: JSValue) -> *mut DOMFormData;
    safe fn WebCore__DOMFormData__append(
        arg0: &mut DOMFormData,
        arg1: &ZigString,
        arg2: &ZigString,
    );
    // safe: `DOMFormData`/`JSGlobalObject` are opaque `UnsafeCell`-backed ZST
    // handles; `&ZigString` is ABI-identical to non-null `*const ZigString` and
    // C++ only reads the named struct via `toStringCopy`. `arg3` is an opaque
    // `*Blob` C++ owns (never dereferenced as Rust data) — same round-trip
    // contract as `Zig__GlobalObject__resetModuleRegistryMap`'s `map` param.
    safe fn WebCore__DOMFormData__appendBlob(
        arg0: &mut DOMFormData,
        arg1: &JSGlobalObject,
        arg2: &ZigString,
        arg3: *mut c_void,
        arg4: &ZigString,
    );
    safe fn WebCore__DOMFormData__count(arg0: &mut DOMFormData) -> usize;
}

impl DOMFormData {
    pub fn create(global: &JSGlobalObject) -> JSValue {
        WebCore__DOMFormData__create(global)
    }

    /// C++ side declares a `THROW_SCOPE` and may throw `ERR_STRING_TOO_LONG`
    /// (returns encoded `JSValue::ZERO` on throw) — wrap in a validation scope
    /// so JSC's `validateExceptionChecks` sees the check before the next scope.
    #[track_caller]
    pub fn create_from_url_query(global: &JSGlobalObject, query: &ZigString) -> JsResult<JSValue> {
        crate::from_js_host_call(global, || {
            WebCore__DOMFormData__createFromURLQuery(global, query)
        })
    }

    pub fn from_js<'a>(value: JSValue) -> Option<&'a mut DOMFormData> {
        // Returned pointer is valid while `value` is kept alive on the stack
        // (conservative GC scan). Null → None. `DOMFormData` is an opaque ZST
        // handle, so `opaque_mut` is the centralised zero-byte deref proof.
        // The unbounded `'a` cannot be expressed more tightly: the cell is
        // GC-owned, so the caller must keep `value` stack-rooted for the
        // lifetime of the returned reference.
        let p = WebCore__DOMFormData__fromJS(value);
        (!p.is_null()).then(|| DOMFormData::opaque_mut(p))
    }

    pub fn append(&mut self, name_: &ZigString, value_: &ZigString) {
        WebCore__DOMFormData__append(self, name_, value_)
    }

    pub fn append_blob(
        &mut self,
        global: &JSGlobalObject,
        name_: &ZigString,
        blob: *mut c_void,
        filename_: &ZigString,
    ) {
        WebCore__DOMFormData__appendBlob(self, global, name_, blob, filename_);
    }

    pub fn count(&mut self) -> usize {
        WebCore__DOMFormData__count(self)
    }
}
