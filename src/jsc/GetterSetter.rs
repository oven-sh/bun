use core::marker::{PhantomData, PhantomPinned};

bun_opaque::opaque_ffi! { pub struct GetterSetter; }

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
