const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;

pub const CustomGetterSetter = extern struct {
    pub const shim = JSC.Shimmer("JSC", "CustomGetterSetter", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/CustomGetterSetter.h";
    pub const name = "JSC::CustomGetterSetter";
    pub const namespace = "JSC";

    pub fn isGetterNull(this: *CustomGetterSetter) bool {
        return shim.cppFn("isGetterNull", .{this});
    }

    pub fn isSetterNull(this: *CustomGetterSetter) bool {
        return shim.cppFn("isSetterNull", .{this});
    }
};
