use core::marker::{PhantomData, PhantomPinned};

#[repr(C)]
pub struct GetterSetter {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl GetterSetter {
    pub fn is_getter_null(&self) -> bool {
        JSC__GetterSetter__isGetterNull(self)
    }

    pub fn is_setter_null(&self) -> bool {
        JSC__GetterSetter__isSetterNull(self)
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    safe fn JSC__GetterSetter__isGetterNull(this: &GetterSetter) -> bool;
    safe fn JSC__GetterSetter__isSetterNull(this: &GetterSetter) -> bool;
}

// ported from: src/jsc/GetterSetter.zig
