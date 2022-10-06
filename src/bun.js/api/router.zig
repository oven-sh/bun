const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const FilesystemRouter = @import("../../router.zig");
const http = @import("../../http.zig");
const JavaScript = @import("../javascript.zig");
const QueryStringMap = @import("../../url.zig").QueryStringMap;
const CombinedScanner = @import("../../url.zig").CombinedScanner;
const bun = @import("../../global.zig");
const string = bun.string;
const JSC = @import("../../jsc.zig");
const js = JSC.C;
const WebCore = @import("../webcore/response.zig");
const Router = @This();
const Bundler = @import("../../bundler.zig");
const VirtualMachine = JavaScript.VirtualMachine;
const ScriptSrcStream = std.io.FixedBufferStream([]u8);
const ZigString = JSC.ZigString;
const Fs = @import("../../fs.zig");
const Base = @import("../base.zig");
const getAllocator = Base.getAllocator;
const JSObject = JSC.JSObject;
const JSError = Base.JSError;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const strings = @import("strings");
const NewClass = Base.NewClass;
const To = Base.To;
const Request = WebCore.Request;
const d = Base.d;
const FetchEvent = WebCore.FetchEvent;
const URLPath = @import("../../http/url_path.zig");
const URL = @import("../../url.zig").URL;

route: *const FilesystemRouter.Match,
route_holder: FilesystemRouter.Match = undefined,
needs_deinit: bool = false,
query_string_map: ?QueryStringMap = null,
param_map: ?QueryStringMap = null,
params_list_holder: FilesystemRouter.Param.List = .{},

pub fn importRoute(
    this: *Router,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    _: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSObjectRef {
    const prom = JSC.JSModuleLoader.loadAndEvaluateModule(ctx.ptr(), &ZigString.init(this.route.file_path));

    VirtualMachine.vm.tick();

    return prom.result(ctx.ptr().vm()).asRef();
}

pub fn match(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    if (arguments.len == 0) {
        JSError(getAllocator(ctx), "Expected string, FetchEvent, or Request but there were no arguments", .{}, ctx, exception);
        return null;
    }

    const arg: JSC.JSValue = brk: {
        if (FetchEvent.Class.isLoaded()) {
            if (JSValue.as(JSValue.fromRef(arguments[0]), FetchEvent)) |fetch_event| {
                if (fetch_event.request_context != null) {
                    return matchFetchEvent(ctx, fetch_event, exception);
                }

                // When disconencted, we still have a copy of the request data in here
                break :brk JSC.JSValue.fromRef(fetch_event.getRequest(ctx, null, null, null));
            }
        }
        break :brk JSC.JSValue.fromRef(arguments[0]);
    };

    var router = JavaScript.VirtualMachine.vm.bundler.router orelse {
        JSError(getAllocator(ctx), "Bun.match needs a framework configured with routes", .{}, ctx, exception);
        return null;
    };

    var path_: ?ZigString.Slice = null;
    var pathname: string = "";
    defer {
        if (path_) |path| {
            path.deinit();
        }
    }

    if (arg.isString()) {
        var path_string = arg.getZigString(ctx.ptr());
        path_ = path_string.toSlice(bun.default_allocator);
        var url = URL.parse(path_.?.slice());
        pathname = url.pathname;
    } else if (arg.as(Request)) |req| {
        var url = URL.parse(req.url);
        pathname = url.pathname;
    }

    if (path_ == null) {
        JSError(getAllocator(ctx), "Expected string, FetchEvent, or Request", .{}, ctx, exception);
        return null;
    }

    const url_path = URLPath.parse(path_.?.slice()) catch {
        JSError(getAllocator(ctx), "Could not parse URL path", .{}, ctx, exception);
        return null;
    };

    var match_params_fallback = std.heap.stackFallback(1024, bun.default_allocator);
    var match_params_allocator = match_params_fallback.get();
    var match_params = FilesystemRouter.Param.List{};
    match_params.ensureTotalCapacity(match_params_allocator, 16) catch unreachable;
    var prev_allocator = router.routes.allocator;
    router.routes.allocator = match_params_allocator;
    defer router.routes.allocator = prev_allocator;
    if (router.routes.matchPage("", url_path, &match_params)) |matched| {
        var match_ = matched;
        var params_list = match_.params.clone(bun.default_allocator) catch unreachable;
        var instance = getAllocator(ctx).create(Router) catch unreachable;

        instance.* = Router{
            .route_holder = match_,
            .route = undefined,
        };
        instance.params_list_holder = params_list;
        instance.route = &instance.route_holder;
        instance.route_holder.params = &instance.params_list_holder;

        return Instance.make(ctx, instance);
    }
    //    router.routes.matchPage

    return JSC.JSValue.jsNull().asObjectRef();
}

fn matchRequest(
    ctx: js.JSContextRef,
    request: *const Request,
    _: js.ExceptionRef,
) js.JSObjectRef {
    return createRouteObject(ctx, request.request_context);
}

fn matchFetchEvent(
    ctx: js.JSContextRef,
    fetch_event: *const FetchEvent,
    _: js.ExceptionRef,
) js.JSObjectRef {
    return createRouteObject(ctx, fetch_event.request_context.?);
}

fn createRouteObject(ctx: js.JSContextRef, req: *const http.RequestContext) js.JSValueRef {
    const route = &(req.matched_route orelse {
        return js.JSValueMakeNull(ctx);
    });

    return createRouteObjectFromMatch(ctx, route);
}

fn createRouteObjectFromMatch(
    ctx: js.JSContextRef,
    route: *const FilesystemRouter.Match,
) js.JSValueRef {
    var router = getAllocator(ctx).create(Router) catch unreachable;
    router.* = Router{
        .route = route,
    };

    return Instance.make(ctx, router);
}

pub const Instance = NewClass(
    Router,
    .{
        .name = "Route",
        .read_only = true,
        .ts = .{
            .class = d.ts.class{
                .tsdoc = 
                \\Route matched from the filesystem.
                ,
            },
        },
    },
    .{
        .finalize = finalize,
        .import = .{
            .rfn = importRoute,
            .ts = d.ts{
                .@"return" = "Object",
                .tsdoc = 
                \\Synchronously load & evaluate the file corresponding to the route. Returns the exports of the route. This is similar to `await import(route.filepath)`, except it's synchronous. It is recommended to use this function instead of `import`. 
                ,
            },
        },
    },
    .{
        .pathname = .{
            .get = getPathname,
            .ro = true,
            .ts = d.ts{
                .@"return" = "string",
                .@"tsdoc" = "URL path as appears in a web browser's address bar",
            },
        },

        .filePath = .{
            .get = getFilePath,
            .ro = true,
            .ts = d.ts{
                .@"return" = "string",
                .tsdoc = 
                \\Project-relative filesystem path to the route file.
                ,
            },
        },
        .scriptSrc = .{
            .get = getScriptSrc,
            .ro = true,
            .ts = d.ts{
                .@"return" = "string",
                .tsdoc = 
                \\src attribute of the script tag that loads the route.
                ,
            },
        },
        .kind = .{
            .get = getKind,
            .ro = true,
            .ts = d.ts{
                .@"return" = "\"exact\" | \"dynamic\" | \"catch-all\" | \"optional-catch-all\"",
            },
        },
        .name = .{
            .get = getRoute,
            .ro = true,
            .ts = d.ts{
                .@"return" = "string",
                .tsdoc = 
                \\Route name
                \\@example
                \\`"blog/posts/[id]"`
                \\`"blog/posts/[id]/[[...slug]]"`
                \\`"blog"`
                ,
            },
        },
        .query = .{
            .get = getQuery,
            .ro = true,
            .ts = d.ts{
                .@"return" = "Record<string, string | string[]>",
                .tsdoc = 
                \\Route parameters & parsed query string values as a key-value object
                \\
                \\@example 
                \\```js
                \\console.assert(router.query.id === "123");
                \\console.assert(router.pathname === "/blog/posts/123");
                \\console.assert(router.route === "blog/posts/[id]");
                \\```
                ,
            },
        },
        .params = .{
            .get = getParams,
            .ro = true,
            .ts = d.ts{
                .@"return" = "Record<string, string | string[]>",
                .tsdoc = 
                \\Route parameters as a key-value object
                \\
                \\@example 
                \\```js
                \\console.assert(router.query.id === "123");
                \\console.assert(router.pathname === "/blog/posts/123");
                \\console.assert(router.route === "blog/posts/[id]");
                \\```
                ,
            },
        },
    },
);

pub fn getFilePath(
    this: *Router,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return ZigString.init(this.route.file_path)
        .withEncoding()
        .toValueGC(ctx.ptr()).asRef();
}

pub fn finalize(
    this: *Router,
) void {
    if (this.query_string_map) |*map| {
        map.deinit();
    }

    if (this.needs_deinit) {
        this.params_list_holder.deinit(bun.default_allocator);
        this.params_list_holder = .{};
        this.needs_deinit = false;
    }

    bun.default_allocator.destroy(this);
}

pub fn getPathname(
    this: *Router,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return ZigString.init(this.route.pathname)
        .withEncoding()
        .toValueGC(ctx.ptr()).asRef();
}

pub fn getRoute(
    this: *Router,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return ZigString.init(this.route.name)
        .withEncoding()
        .toValueGC(ctx.ptr()).asRef();
}

const KindEnum = struct {
    pub const exact = "exact";
    pub const catch_all = "catch-all";
    pub const optional_catch_all = "optional-catch-all";
    pub const dynamic = "dynamic";

    // this is kinda stupid it should maybe just store it
    pub fn init(name: string) ZigString {
        if (strings.contains(name, "[[...")) {
            return ZigString.init(optional_catch_all);
        } else if (strings.contains(name, "[...")) {
            return ZigString.init(catch_all);
        } else if (strings.contains(name, "[")) {
            return ZigString.init(dynamic);
        } else {
            return ZigString.init(exact);
        }
    }
};

pub fn getKind(
    this: *Router,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return KindEnum.init(this.route.name).toValue(ctx.ptr()).asRef();
}

threadlocal var query_string_values_buf: [256]string = undefined;
threadlocal var query_string_value_refs_buf: [256]ZigString = undefined;
pub fn createQueryObject(ctx: js.JSContextRef, map: *QueryStringMap, _: js.ExceptionRef) callconv(.C) js.JSValueRef {
    const QueryObjectCreator = struct {
        query: *QueryStringMap,
        pub fn create(this: *@This(), obj: *JSObject, global: *JSGlobalObject) void {
            var iter = this.query.iter();
            var str: ZigString = undefined;
            while (iter.next(&query_string_values_buf)) |entry| {
                str = ZigString.init(entry.name);

                std.debug.assert(entry.values.len > 0);
                if (entry.values.len > 1) {
                    var values = query_string_value_refs_buf[0..entry.values.len];
                    for (entry.values) |value, i| {
                        values[i] = ZigString.init(value);
                    }
                    obj.putRecord(global, &str, values.ptr, values.len);
                } else {
                    query_string_value_refs_buf[0] = ZigString.init(entry.values[0]);

                    obj.putRecord(global, &str, &query_string_value_refs_buf, 1);
                }
            }
        }
    };

    var creator = QueryObjectCreator{ .query = map };

    var value = JSObject.createWithInitializer(QueryObjectCreator, &creator, ctx.ptr(), map.getNameCount());

    return value.asRef();
}

pub fn getScriptSrcString(
    comptime Writer: type,
    writer: Writer,
    file_path: string,
    client_framework_enabled: bool,
) void {
    var entry_point_tempbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
    // We don't store the framework config including the client parts in the server
    // instead, we just store a boolean saying whether we should generate this whenever the script is requested
    // this is kind of bad. we should consider instead a way to inline the contents of the script.
    if (client_framework_enabled) {
        JSC.API.Bun.getPublicPath(
            Bundler.ClientEntryPoint.generateEntryPointPath(
                &entry_point_tempbuf,
                Fs.PathName.init(file_path),
            ),
            VirtualMachine.vm.origin,
            Writer,
            writer,
        );
    } else {
        JSC.API.Bun.getPublicPath(file_path, VirtualMachine.vm.origin, Writer, writer);
    }
}

pub fn getScriptSrc(
    this: *Router,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    var script_src_buffer = std.ArrayList(u8).init(bun.default_allocator);

    var writer = script_src_buffer.writer();
    getScriptSrcString(@TypeOf(&writer), &writer, this.route.file_path, this.route.client_framework_enabled);

    return ZigString.init(script_src_buffer.toOwnedSlice()).toExternalValue(ctx.ptr()).asObjectRef();
}

pub fn getParams(
    this: *Router,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    if (this.param_map == null) {
        if (this.route.params.len > 0) {
            if (QueryStringMap.initWithScanner(getAllocator(ctx), CombinedScanner.init(
                "",
                this.route.pathnameWithoutLeadingSlash(),
                this.route.name,
                this.route.params,
            ))) |map| {
                this.param_map = map;
            } else |_| {}
        }
    }

    // If it's still null, there are no params
    if (this.param_map) |*map| {
        return createQueryObject(ctx, map, exception);
    } else {
        return JSValue.createEmptyObject(ctx.ptr(), 0).asRef();
    }
}

pub fn getQuery(
    this: *Router,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    if (this.query_string_map == null) {
        if (this.route.params.len > 0) {
            if (QueryStringMap.initWithScanner(getAllocator(ctx), CombinedScanner.init(
                this.route.query_string,
                this.route.pathnameWithoutLeadingSlash(),
                this.route.name,

                this.route.params,
            ))) |map| {
                this.query_string_map = map;
            } else |_| {}
        } else if (this.route.query_string.len > 0) {
            if (QueryStringMap.init(getAllocator(ctx), this.route.query_string)) |map| {
                this.query_string_map = map;
            } else |_| {}
        }
    }

    // If it's still null, the query string has no names.
    if (this.query_string_map) |*map| {
        return createQueryObject(ctx, map, exception);
    } else {
        return JSValue.createEmptyObject(ctx.ptr(), 0).asRef();
    }
}
