use core::marker::{PhantomData, PhantomPinned};

use crate::custom_getter_setter::CustomGetterSetter;
use crate::getter_setter::GetterSetter;
use crate::{JSGlobalObject, JSObject, JSValue};

/// Opaque FFI handle for `JSC::JSCell`.
#[repr(C)]
pub struct JSCell {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl JSCell {
    /// Statically cast a cell to a JSObject. Returns null for non-objects.
    /// Use `to_object` to mutate non-objects into objects.
    pub fn get_object(&self) -> Option<&JSObject> {
        // TODO(port): jsc.markMemberBinding(JSCell, @src()) — comptime binding marker, likely drop
        // SAFETY: FFI call; returned pointer (if non-null) borrows from `self`'s heap cell.
        unsafe { JSC__JSCell__getObject(self).as_ref() }
    }

    /// Convert a cell to a JSObject.
    ///
    /// Statically casts cells that are already objects, otherwise mutates them
    /// into objects.
    ///
    /// ## References
    /// - [ECMA-262 §7.1.18 ToObject](https://tc39.es/ecma262/#sec-toobject)
    pub fn to_object<'a>(&'a self, global: &'a JSGlobalObject) -> &'a JSObject {
        // TODO(port): jsc.markMemberBinding(JSCell, @src()) — comptime binding marker, likely drop
        // SAFETY: FFI call; C++ side never returns null for ToObject on a cell.
        unsafe { &*JSC__JSCell__toObject(self, global) }
    }

    pub fn get_type(&self) -> u8 {
        // TODO(port): jsc.markMemberBinding(JSCell, @src()) — comptime binding marker, likely drop
        // TODO(port): Zig wraps the extern result in @enumFromInt but the fn return type is `u8`;
        // likely intended to return `JSType` — verify in Phase B.
        // SAFETY: plain FFI getter.
        unsafe { JSC__JSCell__getType(self) }
    }

    pub fn to_js(&self) -> JSValue {
        JSValue::from_cell(self)
    }

    pub fn get_getter_setter(&self) -> &GetterSetter {
        debug_assert!(JSValue::from_cell(self).is_getter_setter());
        // SAFETY: caller-asserted invariant — this cell's JSType is GetterSetter.
        unsafe { &*(self as *const JSCell as *const GetterSetter) }
    }

    pub fn get_custom_getter_setter(&self) -> &CustomGetterSetter {
        debug_assert!(JSValue::from_cell(self).is_custom_getter_setter());
        // SAFETY: caller-asserted invariant — this cell's JSType is CustomGetterSetter.
        unsafe { &*(self as *const JSCell as *const CustomGetterSetter) }
    }

    pub fn ensure_still_alive(&self) {
        core::hint::black_box(self as *const JSCell);
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__JSCell__getObject(this: *const JSCell) -> *mut JSObject;
    fn JSC__JSCell__toObject(this: *const JSCell, global: *const JSGlobalObject) -> *mut JSObject;
    // NOTE: this function always returns a JSType, but by using `u8` then
    // casting it via `@enumFromInt` we can ensure our `JSType` enum matches
    // WebKit's. This protects us from possible future breaking changes made
    // when upgrading WebKit.
    fn JSC__JSCell__getType(this: *const JSCell) -> u8;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSCell.zig (64 lines)
//   confidence: high
//   todos:      4
//   notes:      get_type: Zig had @enumFromInt with u8 return — verify intended JSType return; markMemberBinding markers dropped
// ──────────────────────────────────────────────────────────────────────────
