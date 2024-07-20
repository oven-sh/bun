const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const createTypeError = JSC.JSGlobalObject.createTypeErrorInstanceWithCode;
const createError = JSC.JSGlobalObject.createErrorInstanceWithCode;

pub const ERR_SOCKET_BAD_TYPE = createSimpleError(createTypeError, .ERR_SOCKET_BAD_TYPE, "Bad socket type specified. Valid types are: udp4, udp6");
pub const ERR_IPC_CHANNEL_CLOSED = createSimpleError(createError, .ERR_IPC_CHANNEL_CLOSED, "Channel closed");
pub const ERR_INVALID_HANDLE_TYPE = createSimpleError(createTypeError, .ERR_INVALID_HANDLE_TYPE, "This handle type cannot be sent");
pub const ERR_IPC_DISCONNECTED = createSimpleError(createError, .ERR_IPC_DISCONNECTED, "IPC channel is already disconnected");
pub const ERR_CHILD_CLOSED_BEFORE_REPLY = createSimpleError(createError, .ERR_CHILD_CLOSED_BEFORE_REPLY, "Child closed before reply received");
pub const ERR_SERVER_NOT_RUNNING = createSimpleError(createError, .ERR_SERVER_NOT_RUNNING, "Server is not running.");

fn createSimpleError(comptime createFn: anytype, comptime code: JSC.Node.ErrorCode, comptime message: string) JSC.JS2NativeFunctionType {
    const R = struct {
        pub fn cbb(global: *JSC.JSGlobalObject) callconv(JSC.conv) JSC.JSValue {
            const S = struct {
                fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
                    _ = callframe;
                    return createFn(globalThis, code, message, .{});
                }
            };
            return JSC.JSFunction.create(global, @tagName(code), S.cb, 0, .{});
        }
    };
    return R.cbb;
}

pub fn ERR_INVALID_ARG_TYPE(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments(3);
    if (arguments.len < 3) {
        globalThis.throwNotEnoughArguments("ERR_INVALID_ARG_TYPE", 2, arguments.len);
        return .zero;
    }
    return globalThis.ERR_INVALID_ARG_TYPE(arguments.ptr[0], arguments.ptr[1], arguments.ptr[2]);
}

pub fn ERR_MISSING_ARGS(global: *JSC.JSGlobalObject) callconv(JSC.conv) JSC.JSValue {
    const S = struct {
        fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
            const arguments = callframe.arguments(3);
            bun.debugAssert(arguments.len > 0); // At least one arg needs to be specified
            const args = arguments.slice();

            if (!args[0].isArray()) {
                return createTypeError(globalThis, .ERR_MISSING_ARGS, "The \"{}\" argument must be specified", .{args[0].toString(globalThis)});
            }
            return switch (args.len) {
                1 => globalThis.ERR_MISSING_ARGS_1(args[0]),
                2 => globalThis.ERR_MISSING_ARGS_2(args[0], args[1]),
                3 => globalThis.ERR_MISSING_ARGS_3(args[0], args[1], args[2]),
                else => unreachable,
            };
        }
    };
    return JSC.JSFunction.create(global, "ERR_MISSING_ARGS", S.cb, 0, .{});
}
