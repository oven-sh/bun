use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use crate::{JSGlobalObject, JSValue, JsError, JsResult};

/// Opaque type for working with JavaScript `Map` objects.
#[repr(C)]
pub struct JSMap {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
// TODO(port): verify extern signatures against generated C++ bindings (bun.cpp.JSC__JSMap__*)
unsafe extern "C" {
    fn JSC__JSMap__create(global: *mut JSGlobalObject) -> JSValue;
    fn JSC__JSMap__set(this: *mut JSMap, global: *mut JSGlobalObject, key: JSValue, value: JSValue);
    fn JSC__JSMap__get(this: *mut JSMap, global: *mut JSGlobalObject, key: JSValue) -> JSValue;
    fn JSC__JSMap__has(this: *mut JSMap, global: *mut JSGlobalObject, key: JSValue) -> bool;
    fn JSC__JSMap__remove(this: *mut JSMap, global: *mut JSGlobalObject, key: JSValue) -> bool;
    fn JSC__JSMap__clear(this: *mut JSMap, global: *mut JSGlobalObject);
    // C++: uint32_t JSC__JSMap__size(JSC::JSMap*, JSC::JSGlobalObject*) (bindings/headers.h:199)
    fn JSC__JSMap__size(this: *mut JSMap, global: *mut JSGlobalObject) -> u32;
}

impl JSMap {
    pub fn create(global: &JSGlobalObject) -> JSValue {
        // SAFETY: `JSGlobalObject` is an opaque ZST FFI handle (Nomicon pattern); the
        // shared `&JSGlobalObject` covers zero bytes, so passing it as `*mut` to C++
        // via `as_ptr()` does not violate Rust's aliasing/immutability guarantees.
        // `create` is `nothrow` in the codegen (raw `extern fn`, no error wrapper).
        unsafe { JSC__JSMap__create(global.as_ptr()) }
    }

    pub fn set(&mut self, global: &JSGlobalObject, key: JSValue, value: JSValue) -> JsResult<()> {
        // SAFETY: `self` is a uniquely-borrowed *JSMap cell on the GC heap; `global`
        // is an opaque ZST FFI handle (see `JSGlobalObject::as_ptr`).
        unsafe { JSC__JSMap__set(self, global.as_ptr(), key, value) };
        // Mirrors cpp.zig wrapper: `Bun__RETURN_IF_EXCEPTION` after the raw call.
        if global.has_exception() { Err(JsError::Thrown) } else { Ok(()) }
    }

    /// Retrieve a value from this JS Map object.
    ///
    /// Note this shares semantics with the JS `Map.prototype.get` method, and
    /// will return `JSValue::UNDEFINED` if a value is not found.
    pub fn get(&mut self, global: &JSGlobalObject, key: JSValue) -> JsResult<JSValue> {
        // SAFETY: `self` is a uniquely-borrowed *JSMap cell on the GC heap; `global`
        // is an opaque ZST FFI handle (see `JSGlobalObject::as_ptr`).
        let value = unsafe { JSC__JSMap__get(self, global.as_ptr(), key) };
        // Mirrors cpp.zig wrapper: `value == .zero` ⇔ exception thrown.
        if value == JSValue::ZERO { Err(JsError::Thrown) } else { Ok(value) }
    }

    /// Test whether this JS Map object has a given key.
    pub fn has(&mut self, global: &JSGlobalObject, key: JSValue) -> JsResult<bool> {
        // SAFETY: `self` is a uniquely-borrowed *JSMap cell on the GC heap; `global`
        // is an opaque ZST FFI handle (see `JSGlobalObject::as_ptr`).
        let result = unsafe { JSC__JSMap__has(self, global.as_ptr(), key) };
        // Mirrors cpp.zig wrapper: `Bun__RETURN_IF_EXCEPTION` after the raw call.
        if global.has_exception() { Err(JsError::Thrown) } else { Ok(result) }
    }

    /// Attempt to remove a key from this JS Map object.
    pub fn remove(&mut self, global: &JSGlobalObject, key: JSValue) -> JsResult<bool> {
        // SAFETY: `self` is a uniquely-borrowed *JSMap cell on the GC heap; `global`
        // is an opaque ZST FFI handle (see `JSGlobalObject::as_ptr`).
        let result = unsafe { JSC__JSMap__remove(self, global.as_ptr(), key) };
        // Mirrors cpp.zig wrapper: `Bun__RETURN_IF_EXCEPTION` after the raw call.
        if global.has_exception() { Err(JsError::Thrown) } else { Ok(result) }
    }

    /// Clear all entries from this JS Map object.
    pub fn clear(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        // SAFETY: `self` is a uniquely-borrowed *JSMap cell on the GC heap; `global`
        // is an opaque ZST FFI handle (see `JSGlobalObject::as_ptr`).
        unsafe { JSC__JSMap__clear(self, global.as_ptr()) };
        // Mirrors cpp.zig wrapper: `Bun__RETURN_IF_EXCEPTION` after the raw call.
        if global.has_exception() { Err(JsError::Thrown) } else { Ok(()) }
    }

    /// Retrieve the number of entries in this JS Map object.
    pub fn size(&mut self, global: &JSGlobalObject) -> JsResult<u32> {
        // SAFETY: `self` is a uniquely-borrowed *JSMap cell on the GC heap; `global`
        // is an opaque ZST FFI handle (see `JSGlobalObject::as_ptr`).
        let result = unsafe { JSC__JSMap__size(self, global.as_ptr()) };
        // Mirrors cpp.zig wrapper: `Bun__RETURN_IF_EXCEPTION` after the raw call.
        if global.has_exception() { Err(JsError::Thrown) } else { Ok(result) }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSMap.zig (39 lines)
//   confidence: medium
//   todos:      2
//   notes:      extern fn signatures inferred from names (bun.cpp aliases); verify against headers.zig in Phase B.
// ──────────────────────────────────────────────────────────────────────────
