const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const createTypeError = JSC.JSGlobalObject.createTypeErrorInstanceWithCode;

const ERR_SOCKET_BAD_TYPE = createSimpleError(createTypeError, .ERR_SOCKET_BAD_TYPE, "Bad socket type specified. Valid types are: udp4, udp6");

fn createSimpleError(createFn: anytype, comptime code: JSC.Node.ErrorCode, comptime message: string) JSC.JSBuiltinFunctionPtr {
    const R = struct {
        pub fn cbb(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
            const S = struct {
                fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                    _ = callframe;
                    return createFn(globalThis, code, message, .{});
                }
            };
            return JSC.JSFunction.create(global, @tagName(code), S.cb, 0, .{});
        }
    };
    return R.cbb;
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
            const arg2 = arguments.ptr[2].jsTypeString(globalThis);
            return createTypeError(globalThis, .ERR_INVALID_ARG_TYPE, "The \"{}\" argument must be of type {}. Received {}", .{ arg0, arg1, arg2 });
        }
    };
    return JSC.JSFunction.create(global, "ERR_INVALID_ARG_TYPE", S.cb, 3, .{});
}
