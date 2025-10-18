const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

/// Called when a Node.js IncomingMessage is created
/// Generates a request ID and calls onRequestStart callback
pub fn onIncomingMessage(global: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return global.throwNotEnoughArguments("onIncomingMessage", 1, arguments.len);
    }

    const incoming_message = arguments.ptr[0];

    // Get telemetry instance and check if enabled
    const telemetry = bun.telemetry.Telemetry.getInstance() orelse return .js_undefined;
    if (!telemetry.isEnabled()) {
        return .js_undefined;
    }

    // Call notifyRequestStart which generates ID and invokes the callback
    const id = telemetry.notifyRequestStart(incoming_message);

    // Return the request ID so TypeScript can track it
    return jsRequestId(id);
}

// Utility: convert a RequestId to a JavaScript number value
// Matches the helper in telemetry.zig for consistency
inline fn jsRequestId(id: bun.telemetry.RequestId) JSValue {
    return JSValue.jsNumber(@as(f64, @floatFromInt(id)));
}

/// Called when a Node.js ServerResponse finishes
pub fn onResponseFinish(global: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return global.throwNotEnoughArguments("onResponseFinish", 1, arguments.len);
    }

    const id_value = arguments.ptr[0];
    const id_num = try id_value.toNumber(global);
    const id: bun.telemetry.RequestId = @intFromFloat(id_num);

    // Get telemetry instance and check if enabled
    const telemetry = bun.telemetry.Telemetry.getInstance() orelse return .js_undefined;
    if (!telemetry.isEnabled()) {
        return .js_undefined;
    }

    telemetry.notifyRequestEnd(id);

    return .js_undefined;
}

/// Called when a Node.js request encounters an error
pub fn onRequestError(global: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2);
    if (arguments.len < 2) {
        return global.throwNotEnoughArguments("onRequestError", 2, arguments.len);
    }

    const id_value = arguments.ptr[0];
    const error_value = arguments.ptr[1];
    const id_num = try id_value.toNumber(global);
    const id: bun.telemetry.RequestId = @intFromFloat(id_num);

    // Get telemetry instance and check if enabled
    const telemetry = bun.telemetry.Telemetry.getInstance() orelse return .js_undefined;
    if (!telemetry.isEnabled()) {
        return .js_undefined;
    }

    telemetry.notifyRequestError(id, error_value);

    return .js_undefined;
}
