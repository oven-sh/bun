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
