use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use crate::{JSGlobalObject, JSValue, JsError, JsResult};

bun_opaque::opaque_ffi! {
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
    pub fn create(global: &JSGlobalObject) -> JSValue {
        // `create` is `nothrow` in the codegen (raw `extern fn`, no error wrapper).
        JSC__JSMap__create(global)
    }

    #[track_caller]
    pub fn set(&mut self, global: &JSGlobalObject, key: JSValue, value: JSValue) -> JsResult<()> {
        crate::cpp::JSC__JSMap__set(self, global, key, value)
    }

    /// Retrieve a value from this JS Map object.
    ///
    /// Note this shares semantics with the JS `Map.prototype.get` method, and
    /// will return `JSValue::UNDEFINED` if a value is not found.
    #[track_caller]
    pub fn get(&mut self, global: &JSGlobalObject, key: JSValue) -> JsResult<JSValue> {
        crate::cpp::JSC__JSMap__get(self, global, key)
    }

    /// Test whether this JS Map object has a given key.
    #[track_caller]
    pub fn has(&mut self, global: &JSGlobalObject, key: JSValue) -> JsResult<bool> {
        crate::cpp::JSC__JSMap__has(self, global, key)
    }

    /// Attempt to remove a key from this JS Map object.
    #[track_caller]
    pub fn remove(&mut self, global: &JSGlobalObject, key: JSValue) -> JsResult<bool> {
        crate::cpp::JSC__JSMap__remove(self, global, key)
    }

    /// Clear all entries from this JS Map object.
    #[track_caller]
    pub fn clear(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        crate::cpp::JSC__JSMap__clear(self, global)
    }

    /// Retrieve the number of entries in this JS Map object.
    #[track_caller]
    pub fn size(&mut self, global: &JSGlobalObject) -> JsResult<u32> {
        crate::cpp::JSC__JSMap__size(self, global)
    }

    /// Attempt to convert a `JSValue` to a `*JSMap`.
    ///
    /// Returns `None` if the value is not a Map.
    ///
    /// Returns a raw `NonNull<JSMap>` (mirrors Zig's `?*JSMap`). The pointee is a
    /// GC-heap cell; callers must dereference unsafely at use-site and ensure the
    /// underlying `JSValue` is kept alive across GC.
    pub fn from_js(value: JSValue) -> Option<NonNull<JSMap>> {
        // PORT NOTE: Zig used `jsTypeLoose() == .JSMap`; the Rust stub surface
        // exposes `is_cell()` + `js_type()` (which together are equivalent).
        if value.is_cell() && value.js_type() == crate::JSType::Map {
            // SAFETY: value is a Map cell; its encoded pointer is a valid,
            // non-null *JSMap on the GC heap.
            return NonNull::new(value.encoded() as *mut JSMap);
        }
        None
    }
}

// ported from: src/jsc/JSMap.zig
