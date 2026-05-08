use core::marker::{PhantomData, PhantomPinned};

/// Opaque FFI handle for `JSC::CustomGetterSetter`.
#[repr(C)]
pub struct CustomGetterSetter {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl CustomGetterSetter {
    pub fn is_getter_null(&self) -> bool {
        // SAFETY: `self` is a valid `*CustomGetterSetter` obtained from JSC.
        unsafe { JSC__CustomGetterSetter__isGetterNull(self) }
    }

    pub fn is_setter_null(&self) -> bool {
        // SAFETY: `self` is a valid `*CustomGetterSetter` obtained from JSC.
        unsafe { JSC__CustomGetterSetter__isSetterNull(self) }
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__CustomGetterSetter__isGetterNull(this: *const CustomGetterSetter) -> bool;
    fn JSC__CustomGetterSetter__isSetterNull(this: *const CustomGetterSetter) -> bool;
}

// ported from: src/jsc/CustomGetterSetter.zig
