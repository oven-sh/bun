const Init = struct {
    dev: *DevServer,
    aborted: bool,
    resp: AnyResponse,

    fn onAbort(this: *@This(), resp: AnyResponse) void {
        this.aborted = true;
        _ = resp;
    }
};

pub fn onInitRequest(dev: *DevServer, req: *Request, resp: AnyResponse) void {
    onInit(dev, req, resp) catch |err| switch (err) {
        error.OutOfMemory => bun.outOfMemory(),
        error.JSError => |e| {
            bun.handleErrorReturnTrace(err, @errorReturnTrace());
            const err_value = dev.vm.global.takeException(e);
            dev.vm.printErrorLikeObjectToConsole(err_value.toError() orelse err_value);
            resp.corked(onHttp500, .{resp});
        },
    };
}

fn onInit(dev: *DevServer, _: *Request, resp: AnyResponse) bun.JSOOM!void {
    // TODO: auto install code here
    const entry_point_string = bun.String.createUTF8(bun.Environment.base_path ++ "/packages/bun-wumbo/plugin.ts");
    defer entry_point_string.deref();

    const promise = JSBundlerPlugin__loadAndResolveEditPlugin(
        dev.vm.global,
        dev.server.?.jsValue() orelse brk: {
            bun.debugAssert(false);
            break :brk .undefined;
        },
        JSC.JSValue.fromPtr(dev),
        &entry_point_string,
        JSC.JSFunction.create(dev.vm.global, "", addRoutes, 0, .{}),
        JSC.JSFunction.create(dev.vm.global, "", addCallbacks, 0, .{}),
    );
    if (dev.vm.global.hasException()) {
        return error.JSError;
    }

    dev.server.?.onPendingRequest();
    const init = bun.create(dev.allocator, Init, .{
        .dev = dev,
        .resp = resp,
        .aborted = false,
    });
    resp.onAborted(*Init, Init.onAbort, init);
    promise.setHandled(dev.vm.jsc);
    promise.asValue(dev.vm.global).then(
        dev.vm.global,
        init,
        onInitSetupResolve,
        onInitSetupReject,
    );
}

extern fn JSBundlerPlugin__loadAndResolveEditPlugin(
    global: *JSC.JSGlobalObject,
    server: JSC.JSValue,
    dev_server: JSC.JSValue,
    path: *const bun.String,
    fn_1: JSC.JSValue,
    fn_2: JSC.JSValue,
) *JSC.JSPromise;

pub fn onInitSetupResolve(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _, const js_promise = callframe.argumentsAsArray(2);
    const ctx = js_promise.asPtr(Init);
    defer ctx.dev.allocator.destroy(ctx);
    const dev = ctx.dev;

    const entry = dev.addPreload(.client, bun.Environment.base_path ++ "/packages/bun-wumbo/frontend.ts") catch bun.outOfMemory();

    if (!ctx.aborted) {
        ctx.resp.clearAborted();
        ctx.resp.corked(onHttp200, .{ ctx.resp, dev.relativePath(entry.key) });
        dev.releaseRelativePathBuf();
    }
    dev.server.?.onStaticRequestComplete();

    return .undefined;
}

pub fn onInitSetupReject(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const err, const js_promise = callframe.argumentsAsArray(2);
    const ctx = js_promise.asPtr(Init);
    defer ctx.dev.allocator.destroy(ctx);
    const dev = ctx.dev;

    dev.vm.printErrorLikeObjectToConsole(err.toError() orelse err);

    ctx.resp.corked(onHttp500, .{ctx.resp});
    dev.server.?.onStaticRequestComplete();

    return .undefined;
}

fn onHttp500(resp: AnyResponse) void {
    resp.writeStatus("500 Internal Server Error");
    resp.end("Internal Server Error", false);
}

fn onHttp200(resp: AnyResponse, str: []const u8) void {
    resp.writeStatus("200 OK");
    resp.end(str, false);
}

fn addRoutes(global: *JSC.JSGlobalObject, call_frame: *JSC.CallFrame) bun.JSOOM!JSC.JSValue {
    const dev_encoded, const routes = call_frame.argumentsAsArray(2);
    const dev = dev_encoded.asPtr(DevServer);
    bun.assert(dev.server.?.devServer() == dev); // sanity
    if (!routes.isObject()) {
        return global.throwInvalidArguments("Routes must be an object of functions", .{});
    }
    const any_server = dev.server.?;
    const Ptr = JSC.API.AnyServer.Ptr;
    switch (any_server.ptr.tag()) {
        else => @panic("unexpected tag"),
        inline Ptr.case(JSC.API.HTTPServer),
        Ptr.case(JSC.API.HTTPSServer),
        Ptr.case(JSC.API.DebugHTTPServer),
        Ptr.case(JSC.API.DebugHTTPSServer),
        => |tag| {
            var iter = try JSC.JSPropertyIterator(.{
                .skip_empty_name = true,
                .include_value = true,
            }).init(global, routes);
            defer iter.deinit();

            const server = switch (tag) {
                Ptr.case(JSC.API.HTTPServer) => any_server.ptr.as(JSC.API.HTTPServer),
                Ptr.case(JSC.API.HTTPSServer) => any_server.ptr.as(JSC.API.HTTPSServer),
                Ptr.case(JSC.API.DebugHTTPServer) => any_server.ptr.as(JSC.API.DebugHTTPServer),
                Ptr.case(JSC.API.DebugHTTPSServer) => any_server.ptr.as(JSC.API.DebugHTTPSServer),
                else => @compileError(unreachable),
            };

            const start_len = server.plugin_routes.items.len;
            errdefer {
                for (server.plugin_routes.items[start_len..]) |*route| {
                    route.cb.deinit();
                    bun.default_allocator.free(route.path);
                }
                server.plugin_routes.items.len = start_len;
                _ = server.reloadStaticRoutes() catch bun.outOfMemory();
            }

            while (try iter.next()) |key| {
                const path, const is_ascii = key.toOwnedSliceReturningAllASCII(bun.default_allocator) catch bun.outOfMemory();
                errdefer bun.default_allocator.free(path);

                const value: JSC.JSValue = iter.value;

                if (value.isUndefined()) {
                    continue;
                }

                if (path.len == 0 or (path[0] != '/')) {
                    return global.throwInvalidArguments("Invalid route {}. Path must start with '/'", .{bun.fmt.quote(path)});
                }

                if (!is_ascii) {
                    return global.throwInvalidArguments("Invalid route {}. Please encode all non-ASCII characters in the path.", .{bun.fmt.quote(path)});
                }

                if (!value.isCallable(global.vm())) {
                    return global.throwInvalidArguments("Invalid route {}. Must be a function.", .{bun.fmt.quote(path)});
                }

                try server.plugin_routes.append(bun.default_allocator, .{
                    .cb = .create(value, global),
                    .path = path,
                    .server = server,
                });
            }

            _ = try server.reloadStaticRoutes();
        },
    }
    return .undefined;
}

fn addCallbacks(global: *JSC.JSGlobalObject, call_frame: *JSC.CallFrame) bun.JSOOM!JSC.JSValue {
    const dev_encoded, const err_callback, const event_callback = call_frame.argumentsAsArray(3);
    const dev = dev_encoded.asPtr(DevServer);
    bun.assert(dev.server.?.devServer() == dev); // sanity

    dev.on_event_callback_hack.set(global, event_callback);
    dev.on_error_callback_hack.set(global, err_callback);
    return .undefined;
}

const bun = @import("root").bun;
const DevServer = bun.bake.DevServer;
const uws = bun.uws;
const Request = uws.Request;
const AnyResponse = bun.uws.AnyResponse;

const JSC = bun.JSC;

comptime {
    @export(
        &JSC.toJSHostFunction(onInitSetupResolve),
        .{ .name = "DevServer__onInitSetupResolve" },
    );
    @export(
        &JSC.toJSHostFunction(onInitSetupReject),
        .{ .name = "DevServer__onInitSetupReject" },
    );
}
