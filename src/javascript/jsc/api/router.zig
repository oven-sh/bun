const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const FilesystemRouter = @import("../../../router.zig");
const http = @import("../../../http.zig");
const JavaScript = @import("../javascript.zig");
const QueryStringMap = @import("../../../query_string_map.zig").QueryStringMap;
const CombinedScanner = @import("../../../query_string_map.zig").CombinedScanner;
const _global = @import("../../../global.zig");
const string = _global.string;
const js = @import("../JavaScriptCore.zig");
const JSC = @import("../bindings/bindings.zig");
const WebCore = @import("../webcore/response.zig");
const Router = @This();
const Bundler = @import("../../../bundler.zig");
const VirtualMachine = JavaScript.VirtualMachine;
const ScriptSrcStream = std.io.FixedBufferStream([]u8);
const ZigString = JSC.ZigString;
const Fs = @import("../../../fs.zig");
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

route: *const FilesystemRouter.Match,
query_string_map: ?QueryStringMap = null,
param_map: ?QueryStringMap = null,
script_src: ?string = null,
script_src_buf: [1024]u8 = undefined,

script_src_buf_writer: ScriptSrcStream = undefined,

pub fn importRoute(
    this: *Router,
    ctx: js.JSContextRef,
    function: js.JSObjectRef,
    thisObject: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    const prom = JSC.JSModuleLoader.loadAndEvaluateModule(VirtualMachine.vm.global, &ZigString.init(this.route.file_path));

    VirtualMachine.vm.tick();

    return prom.result(VirtualMachine.vm.global.vm()).asRef();
}

pub fn match(
    obj: void,
    ctx: js.JSContextRef,
    function: js.JSObjectRef,
    thisObject: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    if (arguments.len == 0) {
        JSError(getAllocator(ctx), "Expected string, FetchEvent, or Request but there were no arguments", .{}, ctx, exception);
        return null;
    }

    if (js.JSValueIsObjectOfClass(ctx, arguments[0], FetchEvent.Class.get().*)) {
        return matchFetchEvent(ctx, To.Zig.ptr(FetchEvent, arguments[0]), exception);
    }

    if (js.JSValueIsString(ctx, arguments[0])) {
        return matchPathName(ctx, arguments[0], exception);
    }

    if (js.JSValueIsObjectOfClass(ctx, arguments[0], Request.Class.get().*)) {
        return matchRequest(ctx, To.Zig.ptr(Request, arguments[0]), exception);
    }

    return null;
}

fn matchRequest(
    ctx: js.JSContextRef,
    request: *const Request,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    return createRouteObject(ctx, request.request_context, exception);
}

fn matchPathNameString(
    ctx: js.JSContextRef,
    pathname: string,
    exception: js.ExceptionRef,
) js.JSObjectRef {}

fn matchPathName(
    ctx: js.JSContextRef,
    pathname: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    return null;
}

fn matchFetchEvent(
    ctx: js.JSContextRef,
    fetch_event: *const FetchEvent,
    exception: js.ExceptionRef,
) js.JSObjectRef {
    return createRouteObject(ctx, fetch_event.request_context, exception);
}

fn createRouteObject(ctx: js.JSContextRef, req: *const http.RequestContext, exception: js.ExceptionRef) js.JSValueRef {
    const route = &(req.matched_route orelse {
        return js.JSValueMakeNull(ctx);
    });

    var router = getAllocator(ctx).create(Router) catch unreachable;
    router.* = Router{
        .route = route,
    };
    router.script_src_buf_writer = ScriptSrcStream{ .pos = 0, .buffer = std.mem.span(&router.script_src_buf) };

    return Instance.make(ctx, router);
}

pub const match_type_definition = &[_]d.ts{
    .{
        .tsdoc = "Match a {@link https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent FetchEvent} to a `Route` from the local filesystem. Returns `null` if there is no match.",
        .args = &[_]d.ts.arg{
            .{
                .name = "event",
                .@"return" = "FetchEvent",
            },
        },
        .@"return" = "Route | null",
    },
    .{
        .tsdoc = "Match a `pathname` to a `Route` from the local filesystem. Returns `null` if there is no match.",
        .args = &[_]d.ts.arg{
            .{
                .name = "pathname",
                .@"return" = "string",
            },
        },
        .@"return" = "Route | null",
    },
    .{
        .tsdoc = "Match a {@link https://developer.mozilla.org/en-US/docs/Web/API/Request Request} to a `Route` from the local filesystem. Returns `null` if there is no match.",
        .args = &[_]d.ts.arg{
            .{
                .name = "request",
                .@"return" = "Request",
            },
        },
        .@"return" = "Route | null",
    },
};

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
        .finalize = .{
            .rfn = finalize,
        },
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
    thisObject: js.JSObjectRef,
    prop: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    return ZigString.init(this.route.file_path).toValue(VirtualMachine.vm.global).asRef();
}

pub fn finalize(
    this: *Router,
) void {
    if (this.query_string_map) |*map| {
        map.deinit();
    }
}

pub fn getPathname(
    this: *Router,
    ctx: js.JSContextRef,
    thisObject: js.JSObjectRef,
    prop: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    return ZigString.init(this.route.pathname).toValue(VirtualMachine.vm.global).asRef();
}

pub fn getRoute(
    this: *Router,
    ctx: js.JSContextRef,
    thisObject: js.JSObjectRef,
    prop: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    return ZigString.init(this.route.name).toValue(VirtualMachine.vm.global).asRef();
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
    thisObject: js.JSObjectRef,
    prop: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    return KindEnum.init(this.route.name).toValue(VirtualMachine.vm.global).asRef();
}

threadlocal var query_string_values_buf: [256]string = undefined;
threadlocal var query_string_value_refs_buf: [256]ZigString = undefined;
pub fn createQueryObject(ctx: js.JSContextRef, map: *QueryStringMap, exception: js.ExceptionRef) callconv(.C) js.JSValueRef {
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
                    obj.putRecord(VirtualMachine.vm.global, &str, values.ptr, values.len);
                } else {
                    query_string_value_refs_buf[0] = ZigString.init(entry.values[0]);

                    obj.putRecord(VirtualMachine.vm.global, &str, &query_string_value_refs_buf, 1);
                }
            }
        }
    };

    var creator = QueryObjectCreator{ .query = map };

    var value = JSObject.createWithInitializer(QueryObjectCreator, &creator, VirtualMachine.vm.global, map.getNameCount());

    return value.asRef();
}

threadlocal var entry_point_tempbuf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
pub fn getScriptSrcString(
    comptime Writer: type,
    writer: Writer,
    file_path: string,
    client_framework_enabled: bool,
) void {
    // We don't store the framework config including the client parts in the server
    // instead, we just store a boolean saying whether we should generate this whenever the script is requested
    // this is kind of bad. we should consider instead a way to inline the contents of the script.
    if (client_framework_enabled) {
        JavaScript.Bun.getPublicPath(
            Bundler.ClientEntryPoint.generateEntryPointPath(
                &entry_point_tempbuf,
                Fs.PathName.init(file_path),
            ),
            ScriptSrcStream.Writer,
            writer,
        );
    } else {
        JavaScript.Bun.getPublicPath(file_path, ScriptSrcStream.Writer, writer);
    }
}

pub fn getScriptSrc(
    this: *Router,
    ctx: js.JSContextRef,
    thisObject: js.JSObjectRef,
    prop: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    const src = this.script_src orelse brk: {
        getScriptSrcString(ScriptSrcStream.Writer, this.script_src_buf_writer.writer(), this.route.file_path, this.route.client_framework_enabled);
        break :brk this.script_src_buf[0..this.script_src_buf_writer.pos];
    };

    this.script_src = src;

    return js.JSValueMakeString(ctx, ZigString.init(src).toJSStringRef());
}

pub fn getParams(
    this: *Router,
    ctx: js.JSContextRef,
    thisObject: js.JSObjectRef,
    prop: js.JSStringRef,
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
            } else |err| {}
        }
    }

    // If it's still null, there are no params
    if (this.param_map) |*map| {
        return createQueryObject(ctx, map, exception);
    } else {
        return JSValue.createEmptyObject(VirtualMachine.vm.global, 0).asRef();
    }
}

pub fn getQuery(
    this: *Router,
    ctx: js.JSContextRef,
    thisObject: js.JSObjectRef,
    prop: js.JSStringRef,
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
            } else |err| {}
        } else if (this.route.query_string.len > 0) {
            if (QueryStringMap.init(getAllocator(ctx), this.route.query_string)) |map| {
                this.query_string_map = map;
            } else |err| {}
        }
    }

    // If it's still null, the query string has no names.
    if (this.query_string_map) |*map| {
        return createQueryObject(ctx, map, exception);
    } else {
        return JSValue.createEmptyObject(VirtualMachine.vm.global, 0).asRef();
    }
}
