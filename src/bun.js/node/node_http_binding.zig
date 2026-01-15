pub fn getBunServerAllClosedPromise(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    if (arguments.len < 1) {
        return globalThis.throwNotEnoughArguments("getBunServerAllClosePromise", 1, arguments.len);
    }

    const value = arguments[0];

    inline for ([_]type{
        jsc.API.HTTPServer,
        jsc.API.HTTPSServer,
        jsc.API.DebugHTTPServer,
        jsc.API.DebugHTTPSServer,
    }) |Server| {
        if (value.as(Server)) |server| {
            return server.getAllClosedPromise(globalThis);
        }
    }

    return globalThis.throwInvalidArgumentTypeValue("server", "bun.Server", value);
}

pub fn getMaxHTTPHeaderSize(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    _ = globalThis; // autofix
    _ = callframe; // autofix
    return jsc.JSValue.jsNumber(bun.http.max_http_header_size);
}

pub fn setMaxHTTPHeaderSize(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    if (arguments.len < 1) {
        return globalThis.throwNotEnoughArguments("setMaxHTTPHeaderSize", 1, arguments.len);
    }
    const value = arguments[0];
    const num = try value.coerceToInt64(globalThis);
    if (num <= 0) {
        return globalThis.throwInvalidArgumentTypeValue("maxHeaderSize", "non-negative integer", value);
    }
    bun.http.max_http_header_size = @intCast(num);
    return jsc.JSValue.jsNumber(bun.http.max_http_header_size);
}

pub fn getMaxHTTPHeadersCount(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    _ = globalThis;
    _ = callframe;
    return jsc.JSValue.jsNumber(bun.http.max_http_headers_count);
}

pub fn setMaxHTTPHeadersCount(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    if (arguments.len < 1) {
        return globalThis.throwNotEnoughArguments("setMaxHTTPHeadersCount", 1, arguments.len);
    }
    const value = arguments[0];
    const num = try value.coerceToInt64(globalThis);
    if (num < 0) {
        return globalThis.throwInvalidArgumentTypeValue("maxHeadersCount", "non-negative integer", value);
    }
    if (num == 0) {
        bun.http.max_http_headers_count = std.math.maxInt(u32);
    } else {
        bun.http.max_http_headers_count = @intCast(num);
    }
    return jsc.JSValue.jsNumber(bun.http.max_http_headers_count);
}

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
