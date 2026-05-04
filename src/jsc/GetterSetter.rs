use core::marker::{PhantomData, PhantomPinned};

#[repr(C)]
pub struct GetterSetter {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl GetterSetter {
    pub fn is_getter_null(&self) -> bool {
        // SAFETY: `self` is a valid &GetterSetter; FFI fn only reads the JSC cell.
        unsafe { JSC__GetterSetter__isGetterNull(self) }
    }

    pub fn is_setter_null(&self) -> bool {
        // SAFETY: `self` is a valid &GetterSetter; FFI fn only reads the JSC cell.
        unsafe { JSC__GetterSetter__isSetterNull(self) }
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__GetterSetter__isGetterNull(this: *const GetterSetter) -> bool;
    fn JSC__GetterSetter__isSetterNull(this: *const GetterSetter) -> bool;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/GetterSetter.zig (11 lines)
//   confidence: high
//   todos:      1
//   notes:      opaque FFI handle; externs left in place pending jsc_sys crate
// ──────────────────────────────────────────────────────────────────────────
