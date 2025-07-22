const bun = @import("bun");

pub const CustomGetterSetter = opaque {
    pub fn isGetterNull(this: *CustomGetterSetter) bool {
        return bun.cpp.JSC__CustomGetterSetter__isGetterNull(this);
    }

    pub fn isSetterNull(this: *CustomGetterSetter) bool {
        return bun.cpp.JSC__CustomGetterSetter__isSetterNull(this);
    }
};
