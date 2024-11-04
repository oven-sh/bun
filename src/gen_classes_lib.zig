/// Handwritten utility functions for ZigGeneratedClasses.zig
const bun = @import("root").bun;
const JSC = @import("root").bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

const wrapHostFunction = JSC.toJSHostFunction;

pub fn wrapClassMethodCallback(comptime T: type, comptime func: anytype) void {
    return struct {
        pub fn call(ptr: *anyopaque, global: *JSGlobalObject, call_frame: *JSC.CallFrame) callconv(JSC.conv) JSValue {
            return global.exceptionToCPP(func(@as(*T, @alignCast(@ptrCast(ptr))), global, call_frame));
        }
    }.call;
}

pub fn wrapClassGetterCallback(comptime T: type, comptime func: anytype) void {
    return struct {
        pub fn call(ptr: *anyopaque, global: *JSGlobalObject) callconv(JSC.conv) JSValue {
            return func(@as(*T, @alignCast(@ptrCast(ptr))), global);
        }
    }.call;
}

pub fn wrapConstructor(comptime T: type, comptime func: anytype) void {
    return struct {
        pub fn call(ptr: *anyopaque, global: *JSGlobalObject) callconv(JSC.conv) JSValue {
            return func(@as(*T, @alignCast(@ptrCast(ptr))), global);
        }
    }.call;
}
