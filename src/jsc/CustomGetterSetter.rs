use core::marker::{PhantomData, PhantomPinned};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `JSC::CustomGetterSetter`.
    pub struct CustomGetterSetter;
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
