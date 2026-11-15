use crate::bindgen::JsLocal;
use crate::{JSGlobalObject, JSValue, JsResult};

bun_opaque::sealed_handle! {
    /// Opaque type for working with JavaScript `Map` objects.
    pub struct JSMap;
}

// `JSMap` and `JSGlobalObject` are opaque ZST FFI handles (Nomicon pattern);
// `&JSMap` / `&JSGlobalObject` cover zero Rust-visible bytes, so passing them
// to C++ that mutates the underlying GC cell does not violate Rust aliasing.
unsafe extern "C" {
    safe fn JSC__JSMap__create(global: &JSGlobalObject) -> JSValue;
}

impl JSMap {
    pub fn create(global: &JSGlobalObject) -> JsLocal<'_, JSMap> {
        // `create` is `nothrow` in the codegen (raw `extern fn`, no error wrapper).
        Self::from_js(&JSC__JSMap__create(global))
            .unwrap()
            .to_local(global)
    }

    #[track_caller]
    pub fn set(&self, global: &JSGlobalObject, key: JSValue, value: JSValue) -> JsResult<()> {
        crate::cpp::JSC__JSMap__set(self, global, key, value)
    }

    /// Retrieve a value from this JS Map object.
    ///
    /// Note this shares semantics with the JS `Map.prototype.get` method, and
    /// will return `JSValue::UNDEFINED` if a value is not found.
    #[track_caller]
    pub fn get(&self, global: &JSGlobalObject, key: JSValue) -> JsResult<JSValue> {
        crate::cpp::JSC__JSMap__get(self, global, key)
    }

    /// Attempt to remove a key from this JS Map object.
    #[track_caller]
    pub fn remove(&self, global: &JSGlobalObject, key: JSValue) -> JsResult<bool> {
        crate::cpp::JSC__JSMap__remove(self, global, key)
    }

    /// Clear all entries from this JS Map object.
    #[track_caller]
    pub fn clear(&self, global: &JSGlobalObject) -> JsResult<()> {
        crate::cpp::JSC__JSMap__clear(self, global)
    }

    /// Retrieve the number of entries in this JS Map object.
    pub fn size(&self) -> u32 {
        crate::cpp::JSC__JSMap__size(self)
    }

    /// Returns `None` if the value is not a Map.
    #[inline]
    pub fn from_js(value: &JSValue) -> Option<&JSMap> {
        // SAFETY: just checked.
        (value.js_type() == crate::JSType::Map).then(|| unsafe { value.as_cell_unchecked() })
    }
}
