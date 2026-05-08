use core::marker::{PhantomData, PhantomPinned};

/// Opaque FFI handle for `JSC::CustomGetterSetter`.
#[repr(C)]
pub struct CustomGetterSetter {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl CustomGetterSetter {
    pub fn is_getter_null(&self) -> bool {
        JSC__CustomGetterSetter__isGetterNull(self)
    }

    pub fn is_setter_null(&self) -> bool {
        JSC__CustomGetterSetter__isSetterNull(self)
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    safe fn JSC__CustomGetterSetter__isGetterNull(this: &CustomGetterSetter) -> bool;
    safe fn JSC__CustomGetterSetter__isSetterNull(this: &CustomGetterSetter) -> bool;
}

// ported from: src/jsc/CustomGetterSetter.zig
