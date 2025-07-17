pub const GetterSetter = opaque {
    pub fn isGetterNull(this: *GetterSetter) bool {
        return JSC__GetterSetter__isGetterNull(this);
    }

    pub fn isSetterNull(this: *GetterSetter) bool {
        return JSC__GetterSetter__isSetterNull(this);
    }
    extern fn JSC__GetterSetter__isGetterNull(this: *GetterSetter) bool;
    extern fn JSC__GetterSetter__isSetterNull(this: *GetterSetter) bool;
};
