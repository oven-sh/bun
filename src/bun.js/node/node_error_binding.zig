const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const createRangeError = JSC.JSGlobalObject.createRangeErrorInstanceWithCode;

pub fn ERR_INVALID_ARG_TYPE(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments(3);
    if (arguments.len < 3) {
        globalThis.throwNotEnoughArguments("ERR_INVALID_ARG_TYPE", 3, arguments.len);
        return .zero;
    }
    return globalThis.ERR_INVALID_ARG_TYPE(arguments.ptr[0], arguments.ptr[1], arguments.ptr[2]);
}

pub fn ERR_OUT_OF_RANGE(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments(3);
    if (arguments.len < 3) {
        globalThis.throwNotEnoughArguments("ERR_INVALID_ARG_TYPE", 3, arguments.len);
        return .zero;
    }
    const args = arguments.ptr;
    const str = args[0].toString(globalThis).getZigString(globalThis).slice();
    if (globalThis.hasException()) return .zero;
    const range = args[1].toString(globalThis).getZigString(globalThis).slice();
    if (globalThis.hasException()) return .zero;
    const input = args[2].toString(globalThis).getZigString(globalThis).slice();
    if (globalThis.hasException()) return .zero;
    return createRangeError(globalThis, .ERR_OUT_OF_RANGE, "The value of \"{s}\" is out of range. It must be {s}. Received {s}", .{ str, range, input });
}
