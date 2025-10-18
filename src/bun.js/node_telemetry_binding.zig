const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

/// Called when a Node.js IncomingMessage is created
/// Generates a request ID and calls onRequestStart callback
pub fn onIncomingMessage(globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return globalObject.throwNotEnoughArguments("onIncomingMessage", 1, arguments.len);
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
    return bun.telemetry.jsRequestId(id);
}

/// Called when a Node.js ServerResponse finishes
pub fn onResponseFinish(globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return globalObject.throwNotEnoughArguments("onResponseFinish", 1, arguments.len);
    }

    const id = try bun.telemetry.requestIdFromJS(globalObject, arguments.ptr[0]);

    // Get telemetry instance and check if enabled
    const telemetry = bun.telemetry.Telemetry.getInstance() orelse return .js_undefined;
    if (!telemetry.isEnabled()) {
        return .js_undefined;
    }

    telemetry.notifyRequestEnd(id);

    return .js_undefined;
}

/// Called when a Node.js request encounters an error
pub fn onRequestError(globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2);
    if (arguments.len < 2) {
        return globalObject.throwNotEnoughArguments("onRequestError", 2, arguments.len);
    }

    const id = try bun.telemetry.requestIdFromJS(globalObject, arguments.ptr[0]);
    const error_value = arguments.ptr[1];

    // Get telemetry instance and check if enabled
    const telemetry = bun.telemetry.Telemetry.getInstance() orelse return .js_undefined;
    if (!telemetry.isEnabled()) {
        return .js_undefined;
    }

    telemetry.notifyRequestError(id, error_value);

    return .js_undefined;
}

/// Called when a Node.js ServerResponse sends headers
/// Parameters: id (request ID), statusCode, contentLength, headers (optional)
pub fn onResponseHeaders(globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(4); // Accept 3 or 4 arguments
    if (arguments.len < 3) {
        return globalObject.throwNotEnoughArguments("onResponseHeaders", 3, arguments.len);
    }

    const id = try bun.telemetry.requestIdFromJS(globalObject, arguments.ptr[0]);

    const status_num = try arguments.ptr[1].toNumber(globalObject);
    const status: u16 = @intFromFloat(status_num);

    const content_length_num = try arguments.ptr[2].toNumber(globalObject);
    const content_length: u64 = @intFromFloat(content_length_num);

    // Get telemetry instance and check if enabled
    const telemetry = bun.telemetry.Telemetry.getInstance() orelse return .js_undefined;
    if (!telemetry.isEnabled()) {
        return .js_undefined;
    }

    // Check if headers were provided (4th argument)
    if (arguments.len >= 4) {
        const headers_js = arguments.ptr[3];
        // Headers from Node.js are already a plain JS object, no conversion needed
        telemetry.notifyResponseStatusWithHeaders(id, status, content_length, headers_js);
    } else {
        // Backward compatibility - call without headers
        telemetry.notifyResponseStatus(id, status, content_length);
    }

    return .js_undefined;
}
