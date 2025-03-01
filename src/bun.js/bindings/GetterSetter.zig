const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;

pub const GetterSetter = extern struct {
    pub const shim = JSC.Shimmer("JSC", "GetterSetter", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/GetterSetter.h";
    pub const name = "JSC::GetterSetter";
    pub const namespace = "JSC";

    pub fn isGetterNull(this: *GetterSetter) bool {
        return shim.cppFn("isGetterNull", .{this});
    }

    pub fn isSetterNull(this: *GetterSetter) bool {
        return shim.cppFn("isSetterNull", .{this});
    }
};
