const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const uv = bun.windows.libuv;

pub fn internalErrorName(global: *JSC.JSGlobalObject) callconv(JSC.conv) JSC.JSValue {
    const S = struct {
        fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
            const arguments = callframe.arguments(1).slice();
            if (arguments.len < 1) {
                globalThis.throwNotEnoughArguments("internalErrorName", 1, arguments.len);
                return .zero;
            }
            const err_value = arguments[0];
            const err_int = err_value.toInt32();
            const err_i: isize = err_int;
            const err_e = for (std.enums.values(std.c.E)) |e| {
                if (@intFromEnum(e) == -err_i) break e;
            } else return ZigString.static("").toJS(globalThis);
            return bun.String.init(@tagName(err_e)).toJS(globalThis);
        }
    };
    return JSC.JSFunction.create(global, "internalErrorName", S.cb, 1, .{});
}
