const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const uv = bun.windows.libuv;

extern fn Bun__util__jsErrname(*JSC.JSGlobalObject, c_int) JSC.JSValue;

pub fn internalErrorName(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments(1).slice();
    if (arguments.len < 1) {
        globalThis.throwNotEnoughArguments("internalErrorName", 1, arguments.len);
        return .zero;
    }

    const err_value = arguments[0];
    const err_int = err_value.toInt32();
    return Bun__util__jsErrname(globalThis, err_int);
}
