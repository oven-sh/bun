/// Handwritten utility functions for ZigGeneratedClasses.zig
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

pub const WrappedMethod = fn (*anyopaque, *JSGlobalObject, *JSC.CallFrame) callconv(JSC.conv) JSValue;
pub const WrappedMethodWithThis = fn (*anyopaque, *JSGlobalObject, *JSC.CallFrame, JSValue) callconv(JSC.conv) JSValue;
pub const WrappedConstructor = fn (*JSGlobalObject, *JSC.CallFrame) callconv(JSC.conv) ?*anyopaque;
pub const WrappedClassGetterCallback = fn (*anyopaque, *JSGlobalObject) callconv(JSC.conv) JSValue;

pub const wrapHostFunction = JSC.toJSHostFunction;

pub fn wrapMethod(comptime T: type, comptime func: anytype) WrappedMethod {
    return struct {
        pub fn call(ptr: *anyopaque, global: *JSGlobalObject, call_frame: *JSC.CallFrame) callconv(JSC.conv) JSValue {
            return global.errorUnionToCPP(func(@as(*T, @alignCast(@ptrCast(ptr))), global, call_frame));
        }
    }.call;
}

pub fn wrapMethodWithThis(comptime T: type, comptime func: anytype) WrappedMethodWithThis {
    return struct {
        pub fn call(ptr: *anyopaque, global: *JSGlobalObject, call_frame: *JSC.CallFrame, this_value: JSValue) callconv(JSC.conv) JSValue {
            return global.errorUnionToCPP(func(@as(*T, @alignCast(@ptrCast(ptr))), global, call_frame, this_value));
        }
    }.call;
}

pub fn wrapConstructor(comptime T: type, comptime func: anytype) WrappedConstructor {
    return struct {
        pub fn call(global: *JSGlobalObject, call_frame: *JSC.CallFrame) callconv(JSC.conv) ?*anyopaque {
            return @as(?*T, global.errorUnionToCPP(func(global, call_frame)));
        }
    }.call;
}

pub fn wrapGetterCallback(comptime T: type, comptime func: anytype) WrappedClassGetterCallback {
    return struct {
        pub fn call(ptr: *anyopaque, global: *JSGlobalObject) callconv(JSC.conv) JSValue {
            return func(@as(*T, @alignCast(@ptrCast(ptr))), global);
        }
    }.call;
}

pub fn wrapGetterWithValueCallback(comptime T: type, comptime func: anytype) WrappedClassGetterCallback {
    return struct {
        pub fn call(ptr: *anyopaque, global: *JSGlobalObject) callconv(JSC.conv) JSValue {
            return func(@as(*T, @alignCast(@ptrCast(ptr))), global);
        }
    }.call;
}
