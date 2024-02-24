/// Handwritten utility functions for ZigGeneratedClasses.zig
const bun = @import("root").bun;
const JSC = @import("root").bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

pub fn wrapHostFunction(comptime func: anytype) void {
    return struct {
        pub fn call(
            global: *JSGlobalObject,
            call_frame: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            return global.exceptionToCPP(func(global, call_frame));
        }
    }.call;
}

pub fn wrapGenClassMethodCallback(comptime func: anytype) void {
    return struct {
        pub fn call(
            ptr: *anyopaque,
            global: *JSGlobalObject,
            call_frame: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            return global.exceptionToCPP(func(@ptrCast(ptr), global, call_frame));
        }
    }.call;
}

pub fn wrapGenClassGetterCallback(comptime func: anytype) void {
    return struct {
        pub fn call(
            ptr: *anyopaque,
            global: *JSGlobalObject,
        ) callconv(.C) JSValue {
            return global.exceptionToCPP(func(@ptrCast(ptr), global));
        }
    }.call;
}
