const bun = @import("bun");
const JSC = bun.JSC;

pub fn getBunServerAllClosedPromise(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    if (arguments.len < 1) {
        return globalThis.throwNotEnoughArguments("getBunServerAllClosePromise", 1, arguments.len);
    }

    const value = arguments[0];

    inline for ([_]type{
        JSC.API.HTTPServer,
        JSC.API.HTTPSServer,
        JSC.API.DebugHTTPServer,
        JSC.API.DebugHTTPSServer,
    }) |Server| {
        if (value.as(Server)) |server| {
            return server.getAllClosedPromise(globalThis);
        }
    }

    return globalThis.throwInvalidArgumentTypeValue("server", "bun.Server", value);
}

pub fn getMaxHTTPHeaderSize(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _ = globalThis; // autofix
    _ = callframe; // autofix
    return JSC.JSValue.jsNumber(bun.http.max_http_header_size);
}

pub fn setMaxHTTPHeaderSize(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    if (arguments.len < 1) {
        return globalThis.throwNotEnoughArguments("setMaxHTTPHeaderSize", 1, arguments.len);
    }
    const value = arguments[0];
    const num = value.coerceToInt64(globalThis);
    if (num <= 0) {
        return globalThis.throwInvalidArgumentTypeValue("maxHeaderSize", "non-negative integer", value);
    }
    bun.http.max_http_header_size = @intCast(num);
    return JSC.JSValue.jsNumber(bun.http.max_http_header_size);
}
