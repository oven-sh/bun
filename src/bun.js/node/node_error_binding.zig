const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const createTypeError = JSC.JSGlobalObject.createTypeErrorInstanceWithCode;
const createError = JSC.JSGlobalObject.createErrorInstanceWithCode;
const createRangeError = JSC.JSGlobalObject.createRangeErrorInstanceWithCode;

pub const ERR_INVALID_HANDLE_TYPE = createSimpleError(createTypeError, .ERR_INVALID_HANDLE_TYPE, "This handle type cannot be sent");
pub const ERR_CHILD_CLOSED_BEFORE_REPLY = createSimpleError(createError, .ERR_CHILD_CLOSED_BEFORE_REPLY, "Child closed before reply received");

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
