pub const CustomGetterSetter = opaque {
    pub fn isGetterNull(this: *CustomGetterSetter) bool {
        return JSC__CustomGetterSetter__isGetterNull(this);
    }

    pub fn isSetterNull(this: *CustomGetterSetter) bool {
        return JSC__CustomGetterSetter__isSetterNull(this);
    }
    extern fn JSC__CustomGetterSetter__isGetterNull(this: *CustomGetterSetter) bool;
    extern fn JSC__CustomGetterSetter__isSetterNull(this: *CustomGetterSetter) bool;
};
