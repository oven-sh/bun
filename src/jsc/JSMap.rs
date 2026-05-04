use core::marker::{PhantomData, PhantomPinned};

use bun_jsc::{JSGlobalObject, JSValue, JsType};

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
    fn JSC__JSMap__size(this: *mut JSMap) -> u32;
}

impl JSMap {
    pub fn create(global: &JSGlobalObject) -> JSValue {
        // SAFETY: global is a valid borrowed JSGlobalObject; FFI takes it as raw.
        unsafe { JSC__JSMap__create(global as *const _ as *mut _) }
    }

    pub fn set(&mut self, global: &JSGlobalObject, key: JSValue, value: JSValue) {
        // SAFETY: self is a valid *JSMap cell on the GC heap.
        unsafe { JSC__JSMap__set(self, global as *const _ as *mut _, key, value) }
    }

    /// Retrieve a value from this JS Map object.
    ///
    /// Note this shares semantics with the JS `Map.prototype.get` method, and
    /// will return `JSValue::UNDEFINED` if a value is not found.
    pub fn get(&mut self, global: &JSGlobalObject, key: JSValue) -> JSValue {
        // SAFETY: self is a valid *JSMap cell on the GC heap.
        unsafe { JSC__JSMap__get(self, global as *const _ as *mut _, key) }
    }

    /// Test whether this JS Map object has a given key.
    pub fn has(&mut self, global: &JSGlobalObject, key: JSValue) -> bool {
        // SAFETY: self is a valid *JSMap cell on the GC heap.
        unsafe { JSC__JSMap__has(self, global as *const _ as *mut _, key) }
    }

    /// Attempt to remove a key from this JS Map object.
    pub fn remove(&mut self, global: &JSGlobalObject, key: JSValue) -> bool {
        // SAFETY: self is a valid *JSMap cell on the GC heap.
        unsafe { JSC__JSMap__remove(self, global as *const _ as *mut _, key) }
    }

    /// Clear all entries from this JS Map object.
    pub fn clear(&mut self, global: &JSGlobalObject) {
        // SAFETY: self is a valid *JSMap cell on the GC heap.
        unsafe { JSC__JSMap__clear(self, global as *const _ as *mut _) }
    }

    /// Retrieve the number of entries in this JS Map object.
    pub fn size(&mut self) -> u32 {
        // SAFETY: self is a valid *JSMap cell on the GC heap.
        unsafe { JSC__JSMap__size(self) }
    }

    /// Attempt to convert a `JSValue` to a `&mut JSMap`.
    ///
    /// Returns `None` if the value is not a Map.
    // TODO(port): 'static is a stand-in lifetime — JSMap is a GC-heap cell; refine ownership in Phase B.
    pub fn from_js(value: JSValue) -> Option<&'static mut JSMap> {
        if value.js_type_loose() == JsType::Map {
            // SAFETY: value is a Map cell; its encoded pointer is a valid, non-null *JSMap on the GC heap.
            return Some(unsafe { &mut *value.as_encoded().as_ptr.unwrap().cast::<JSMap>() });
        }

        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSMap.zig (39 lines)
//   confidence: medium
//   todos:      3
//   notes:      extern fn signatures inferred from names (bun.cpp aliases); verify against headers.zig in Phase B.
//              from_js returns &'static mut as placeholder — GC-heap lifetime needs Phase B modeling.
// ──────────────────────────────────────────────────────────────────────────
