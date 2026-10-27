bun_opaque::opaque_ffi! { pub struct GetterSetter; }

impl GetterSetter {
    pub(crate) fn is_getter_null(&self) -> bool {
        JSC__GetterSetter__isGetterNull(self)
    }

    pub(crate) fn is_setter_null(&self) -> bool {
        JSC__GetterSetter__isSetterNull(self)
    }
}

unsafe extern "C" {
    safe fn JSC__GetterSetter__isGetterNull(this: &GetterSetter) -> bool;
    safe fn JSC__GetterSetter__isSetterNull(this: &GetterSetter) -> bool;
}
