const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const uv = bun.windows.libuv;

pub fn getBunServerAllClosedPromise(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments(1).slice();
    if (arguments.len < 1) {
        globalThis.throwNotEnoughArguments("getBunServerAllClosePromise", 1, arguments.len);
        return .zero;
    }

    const value = arguments[0];

    inline for ([_]type{
        JSC.API.HTTPServer,
        JSC.API.HTTPSServer,
        JSC.API.DebugHTTPServer,
        JSC.API.DebugHTTPSServer,
    }) |Server| {
        if (value.as(Server)) |server| {
            if (server.listener == null and server.pending_requests == 0) {
                return JSC.JSPromise.resolvedPromise(globalThis, .undefined).asValue(globalThis);
            }
            const prom = &server.all_closed_promise;
            if (prom.strong.has()) {
                return prom.value();
            }
            prom.* = JSC.JSPromise.Strong.init(globalThis);
            return prom.value();
        }
    }

    return globalThis.throwInvalidArgumentTypeValue("server", "bun.Server", value);
}

pub fn getMaxHTTPHeaderSize(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    _ = globalThis; // autofix
    _ = callframe; // autofix
    return JSC.JSValue.jsNumber(bun.http.max_http_header_size);
}

pub fn setMaxHTTPHeaderSize(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments(1).slice();
    if (arguments.len < 1) {
        globalThis.throwNotEnoughArguments("setMaxHTTPHeaderSize", 1, arguments.len);
        return .zero;
    }
    const value = arguments[0];
    const num = value.coerceToInt64(globalThis);
    if (num <= 0) {
        return globalThis.throwInvalidArgumentTypeValue("maxHeaderSize", "non-negative integer", value);
    }
    bun.http.max_http_header_size = @intCast(num);
    return JSC.JSValue.jsNumber(bun.http.max_http_header_size);
}
