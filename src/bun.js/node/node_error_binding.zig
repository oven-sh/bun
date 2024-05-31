const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const createTypeError = JSC.JSGlobalObject.createTypeErrorInstanceWithCode;

pub fn ERR_SOCKET_BAD_TYPE(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const S = struct {
        fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            _ = callframe;
            return createTypeError(globalThis, .ERR_SOCKET_BAD_TYPE, "Bad socket type specified. Valid types are: udp4, udp6", .{});
        }
    };
    return JSC.JSFunction.create(global, "ERR_SOCKET_BAD_TYPE", S.cb, 0, .{});
}

pub fn ERR_INVALID_ARG_TYPE(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const S = struct {
        fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const arguments = callframe.arguments(3);
            if (arguments.len < 2) {
                globalThis.throwNotEnoughArguments("ERR_INVALID_ARG_TYPE", 2, arguments.len);
                return .zero;
            }
            const arg0 = arguments.ptr[0].toString(globalThis);
            const arg1 = arguments.ptr[1].toString(globalThis);
            const arg2 = arguments.ptr[2].toString(globalThis);
            return createTypeError(globalThis, .ERR_INVALID_ARG_TYPE, "The \"{}\" argument must be of type {}. Received {}", .{ arg0, arg1, arg2 });
        }
    };
    return JSC.JSFunction.create(global, "ERR_INVALID_ARG_TYPE", S.cb, 0, .{});
}
