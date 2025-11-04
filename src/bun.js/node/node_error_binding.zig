pub const ERR_INVALID_HANDLE_TYPE = createSimpleError(createTypeError, .ERR_INVALID_HANDLE_TYPE, "This handle type cannot be sent");
pub const ERR_CHILD_CLOSED_BEFORE_REPLY = createSimpleError(createError, .ERR_CHILD_CLOSED_BEFORE_REPLY, "Child closed before reply received");

fn createSimpleError(comptime createFn: anytype, comptime code: jsc.Node.ErrorCode, comptime message: string) jsc.JS2NativeFunctionType {
    const R = struct {
        pub fn cbb(global: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
            const S = struct {
                fn cb(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
                    _ = callframe;
                    return createFn(globalThis, code, message, .{});
                }
            };
            return jsc.JSFunction.create(global, @tagName(code), S.cb, 0, .{});
        }
    };
    return R.cbb;
}

const string = []const u8;

const bun = @import("bun");
const jsc = bun.jsc;

const createError = jsc.JSGlobalObject.createErrorInstanceWithCode;
const createTypeError = jsc.JSGlobalObject.createTypeErrorInstanceWithCode;
