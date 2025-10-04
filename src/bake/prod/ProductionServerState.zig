const log = Output.scoped(.bake_prod, .visible);
const httplog = log;

const Self = @This();

route_list: jsc.Strong,
bake_server_runtime_handler: jsc.Strong,
/// Pointer is owned by the arena inside Manifest
manifest: *bun.bake.Manifest,

pub const ProductionFrameworkRouter = @import("./ProductionFrameworkRouter.zig");

pub fn getRouter(this: *Self) *bun.bake.FrameworkRouter {
    return this.manifest.router.get();
}

pub fn deinit(this: *Self) void {
    this.route_list.deinit();
    this.bake_server_runtime_handler.deinit();
    this.manifest.deinit();
}

pub fn create(
    globalObject: *JSGlobalObject,
    _: *bun.transpiler.Transpiler,
    config: *bun.api.ServerConfig,
    bake_opts: *const bun.bake.UserOptions,
) JSError!bun.ptr.Owned(*Self) {
    // const allocator = bun.default_allocator;

    const manifest: *Manifest = bun.take(&config.bake_manifest) orelse {
        return globalObject.throw("Manifest not configured", .{});
    };

    const route_list = try SSRRouteList.create(globalObject, manifest.routes.len);

    const build_output_dir = manifest.build_output_dir;

    // Create absolute path for build output dir
    const server_runtime_path = bun.path.joinAbsString(
        bake_opts.root,
        &.{ build_output_dir, "_bun", "server-runtime.js" },
        .auto,
    );

    const bake_server_runtime_handler = try initBakeServerRuntime(globalObject, server_runtime_path, manifest.routes.len);

    const self: Self = .{
        .route_list = jsc.Strong.create(route_list, globalObject),
        .bake_server_runtime_handler = bake_server_runtime_handler,
        .manifest = manifest,
    };

    return bun.ptr.Owned(*Self).new(self);
}

pub fn initBakeServerRuntime(global: *JSGlobalObject, server_runtime_path: []const u8, routes_len: usize) !jsc.Strong {
    // Get the production server runtime code
    const runtime_code = bun.String.static(bun.bake.getProductionRuntime(.server).code);

    // Convert path to bun.String for passing to C++
    const path_str = bun.String.cloneUTF8(server_runtime_path);
    defer path_str.deref();

    // Load and execute the production server runtime IIFE
    const exports_object = BakeLoadProductionServerCode(global, runtime_code, path_str) catch {
        return global.throw("Server runtime failed to start", .{});
    };

    if (!exports_object.isObject()) {
        return global.throw("Server runtime failed to load - expected an object", .{});
    }

    // Extract and store the handleRequest function from the exports object
    const handle_request_fn = exports_object.get(global, "handleRequest") catch null orelse {
        return global.throw("Server runtime module is missing 'handleRequest' export", .{});
    };

    if (!handle_request_fn.isCallable()) {
        return global.throw("Server runtime module's 'handleRequest' export is not a function", .{});
    }

    handle_request_fn.ensureStillAlive();

    const initialize_fn = exports_object.get(global, "initialize") catch null orelse {
        return global.throw("Server runtime module is missing 'initialize' export", .{});
    };

    if (!initialize_fn.isCallable()) {
        return global.throw("Server runtime module's 'initialize' export is not a function", .{});
    }

    _ = try initialize_fn.call(global, global.toJSValue(), &.{
        JSValue.jsNumberFromUint64(routes_len),
        Bake__getEnsureAsyncLocalStorageInstanceJSFunction(global),
        Bake__getProdDataForInitializationJSFunction(global),
        Bake__getProdNewRouteParamsJSFunction(global),
    });

    return jsc.Strong.create(handle_request_fn, global);
}

fn BakeLoadProductionServerCode(global: *jsc.JSGlobalObject, code: bun.String, path: bun.String) bun.JSError!jsc.JSValue {
    const f = @extern(*const fn (*jsc.JSGlobalObject, bun.String, bun.String) callconv(.c) jsc.JSValue, .{ .name = "BakeLoadProductionServerCode" }).*;
    return bun.jsc.fromJSHostCall(global, @src(), f, .{ global, code, path });
}

pub fn routeDataForInitialization(
    globalObject: *JSGlobalObject,
    request: *bun.webcore.Request,
    router_index: usize,
    out_router_type_main: *JSValue,
    out_route_modules: *JSValue,
    out_client_entry_url: *JSValue,
    out_styles: *JSValue,
) JSError!void {
    const server = request.request_context.getBakeProdState() orelse {
        return globalObject.throw("Request context is not a production server state", .{});
    };

    const rtr = server.getRouter();

    if (router_index >= rtr.routes.items.len) {
        return globalObject.throw("Router index out of bounds", .{});
    }

    const route = switch (server.manifest.routes[router_index]) {
        .ssr => |*ssr| ssr,
        else => {
            return globalObject.throw("Route is not an SSR route", .{});
        },
    };

    const router_type_index = rtr.routePtr(Route.Index.init(@truncate(router_index))).type;
    const router_type_main = bun.String.init(server.manifest.router_types[router_type_index.get()].server_entrypoint);
    out_router_type_main.* = router_type_main.toJS(globalObject);

    const route_modules = try jsc.JSValue.createEmptyArray(globalObject, route.modules.len);
    for (route.modules.slice(), 0..) |module_path, i| {
        const module_str = bun.String.init(module_path);
        try route_modules.putIndex(globalObject, @intCast(i), module_str.toJS(globalObject));
    }
    out_route_modules.* = route_modules;

    const client_entry_url = bun.String.init(route.entrypoint).toJS(globalObject);
    out_client_entry_url.* = client_entry_url;

    const styles = try jsc.JSValue.createEmptyArray(globalObject, route.styles.len);
    for (route.styles.slice(), 0..) |style_path, i| {
        const style_str = bun.String.init(style_path);
        try styles.putIndex(globalObject, @intCast(i), style_str.toJS(globalObject));
    }
    out_styles.* = styles;
}

export fn Bun__BakeProductionSSRRouteInfo__dataForInitialization(
    globalObject: *JSGlobalObject,
    zigRequestPtr: *anyopaque,
    routerIndex: usize,
    routerTypeMain: *JSValue,
    routeModules: *JSValue,
    clientEntryUrl: *JSValue,
    styles: *JSValue,
) callconv(jsc.conv) c_int {
    const request: *bun.webcore.Request = @ptrCast(@alignCast(zigRequestPtr));
    routeDataForInitialization(globalObject, request, routerIndex, routerTypeMain, routeModules, clientEntryUrl, styles) catch |err| {
        if (err == error.OutOfMemory) bun.outOfMemory();
        return 0;
    };
    return 1;
}

export fn Bake__getProdNewRouteParamsJSFunctionImpl(global: *bun.jsc.JSGlobalObject, callframe: *jsc.CallFrame) callconv(jsc.conv) bun.jsc.JSValue {
    return jsc.toJSHostCall(global, @src(), newRouteParamsJS, .{ global, callframe });
}

pub fn newRouteParamsJS(global: *bun.jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!bun.jsc.JSValue {
    if (callframe.argumentsCount() != 2) {
        return global.throw("Expected 3 arguments", .{});
    }

    const request_js = callframe.argument(0);
    const url_js = callframe.argument(1);

    if (!request_js.isObject()) return global.throw("Request must be an object", .{});
    if (!url_js.isString()) return global.throw("URL must be a string", .{});

    const request = request_js.as(bun.webcore.Request) orelse return global.throw("Request must be a Request object", .{});
    const self = request.request_context.getBakeProdState() orelse return global.throw("Request context is not a production server state", .{});

    const url = try url_js.toBunString(global);
    const url_utf8 = url.toUTF8(bun.default_allocator);
    defer url_utf8.deinit();

    const pathname = FrameworkRouter.extractPathnameFromUrl(url_utf8.byteSlice());
    var params: bun.bake.FrameworkRouter.MatchedParams = undefined;
    const route_index = self.getRouter().matchSlow(pathname, &params) orelse return global.throw("No route found for path: {s}", .{url_utf8.byteSlice()});

    const route = self.manifest.routes[route_index.get()];
    switch (route) {
        .ssr => {},
        .ssg => |*ssg| {
            const html_store = ssg.store orelse return global.throw("No HML blob found for path: {s}", .{url_utf8.byteSlice()});
            html_store.ref();
            const blob = jsc.WebCore.Blob{
                .size = jsc.WebCore.Blob.max_size,
                .store = html_store,
                .content_type = bun.http.MimeType.html.value,
                .globalThis = global,
            };
            return jsc.WebCore.Blob.new(blob).toJS(global);
        },
        .ssg_many => {
            // FIXME: i don't like allocating just to make the key. We only use the `params` field of SSG when reconstructing the URL path when we setup the routess
            var lookup_key = try Manifest.Route.SSG.fromMatchedParams(bun.default_allocator, &params);
            defer lookup_key.params.deinit(bun.default_allocator);

            const ssg = route.ssg_many.getKeyPtr(lookup_key) orelse
                return global.throw("No pre-rendered page found for this parameter combination: {s}", .{url_utf8.byteSlice()});

            const html_store = ssg.store orelse return global.throw("No HTML blob found for path: {s}", .{url_utf8.byteSlice()});
            html_store.ref();
            const blob = jsc.WebCore.Blob{
                .size = jsc.WebCore.Blob.max_size,
                .store = html_store,
                .content_type = bun.http.MimeType.html.value,
                .globalThis = global,
            };
            return jsc.WebCore.Blob.new(blob).toJS(global);
        },
        .empty => return global.throw("Path points to an invalid route: {s}", .{url_utf8.byteSlice()}),
    }

    var result = try JSValue.createEmptyArray(global, 1);
    result.putIndex(global, 0, JSValue.jsNumberFromUint64(route_index.get())) catch unreachable;
    result.putIndex(global, 1, params.toJS(global)) catch unreachable;

    return result;
}

extern "C" fn Bake__getProdNewRouteParamsJSFunction(global: *bun.jsc.JSGlobalObject) callconv(jsc.conv) bun.jsc.JSValue;

/// Create a JS object representing the passed in matched params. This uses
/// structure caching.
pub fn createParamsObject(
    self: *Self,
    global: *bun.jsc.JSGlobalObject,
    route_index: bun.bake.FrameworkRouter.Route.Index,
    params: *const bun.bake.FrameworkRouter.MatchedParams,
) bun.JSError!bun.jsc.JSValue {
    const params_structure = try SSRRouteList.getRouteParamsStructure(
        global,
        self.route_list.get(),
        route_index.get(),
    ) orelse params_structure: {
        // MatchedParams enforces a limit of 64 parameters
        var js_params: [64]bun.String = undefined;
        var it = params.keyIterator();
        var i: usize = 0;
        while (it.next()) |key| {
            js_params[i] = bun.String.init(key);
            i += 1;
        }
        const params_structure = try SSRRouteList.createRouteParamsStructure(
            global,
            self.route_list.get(),
            route_index.get(),
            js_params[0..i],
        );
        break :params_structure params_structure;
    };
    return try params.toJSWithStructure(global, params_structure);
}

pub fn newRouteParams(
    self: *Self,
    global: *bun.jsc.JSGlobalObject,
    route_index: bun.bake.FrameworkRouter.Route.Index,
    params: *const bun.bake.FrameworkRouter.MatchedParams,
) bun.JSError!struct {
    route_index: JSValue,
    params: JSValue,
} {
    // Convert params to JSValue
    const params_js = try self.createParamsObject(global, route_index, params);

    return .{
        .route_index = JSValue.jsNumberFromUint64(route_index.get()),
        .params = params_js,
    };
}

pub fn Bake__getEnsureAsyncLocalStorageInstanceJSFunction(global: *jsc.JSGlobalObject) jsc.JSValue {
    const f = @extern(*const fn (*jsc.JSGlobalObject) callconv(.c) jsc.JSValue, .{ .name = "Bake__getEnsureAsyncLocalStorageInstanceJSFunction" }).*;
    return f(global);
}

pub fn Bake__getProdDataForInitializationJSFunction(global: *jsc.JSGlobalObject) jsc.JSValue {
    const f = @extern(*const fn (*jsc.JSGlobalObject) callconv(.c) jsc.JSValue, .{ .name = "Bake__getProdDataForInitializationJSFunction" }).*;
    return f(global);
}

pub fn reconstructPathFromParams(
    this: *Self,
    allocator: std.mem.Allocator,
    route_index: u32,
    params: *const bun.BabyList(bun.bake.Manifest.ParamEntry),
) ![]const u8 {
    const router = this.getRouter();
    if (route_index >= router.routes.items.len) return error.InvalidRouteIndex;

    const target_route = &router.routes.items[route_index];
    var parts = std.ArrayList(u8).init(allocator);
    defer parts.deinit();

    // Reconstruct the URL path from the route parts and params
    var current_route: ?*const bun.bake.FrameworkRouter.Route = target_route;
    var path_parts = std.ArrayList(bun.bake.FrameworkRouter.Part).init(allocator);
    defer path_parts.deinit();

    // Collect all parts from parent routes to build the full path
    while (current_route) |r| {
        try path_parts.append(r.part);
        if (r.parent.unwrap()) |parent_idx| {
            current_route = &router.routes.items[parent_idx.get()];
        } else {
            current_route = null;
        }
    }

    // Reverse the parts array since we collected from child to parent
    std.mem.reverse(bun.bake.FrameworkRouter.Part, path_parts.items);

    // Build the URL path
    for (path_parts.items) |part| {
        if (part == .text and part.text.len == 0) continue;
        try parts.append('/');
        switch (part) {
            .text => |text| try parts.appendSlice(text),
            .param => |param_name| {
                // Find the param value from the params list
                var found = false;
                for (params.slice()) |param| {
                    if (strings.eql(param.key, param_name)) {
                        switch (param.value) {
                            .single => |val| try parts.appendSlice(val),
                            .multiple => |vals| {
                                // For regular params, just use the first value
                                if (vals.len > 0) {
                                    try parts.appendSlice(vals.slice()[0]);
                                }
                            },
                        }
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    // If param not found, use the param name as placeholder
                    try parts.append('[');
                    try parts.appendSlice(param_name);
                    try parts.append(']');
                }
            },
            .catch_all, .catch_all_optional => |name| {
                // For catch-all routes, look for the param with multiple values
                var found = false;
                for (params.slice()) |param| {
                    if (strings.eql(param.key, name)) {
                        switch (param.value) {
                            .single => |val| try parts.appendSlice(val),
                            .multiple => |vals| {
                                // Join all values with slashes for catch-all
                                for (vals.slice(), 0..) |val, i| {
                                    if (i > 0) try parts.append('/');
                                    try parts.appendSlice(val);
                                }
                            },
                        }
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    // If param not found, use placeholder
                    try parts.appendSlice("[...");
                    try parts.appendSlice(name);
                    try parts.append(']');
                }
            },
            .group => {}, // Groups don't affect URL
        }
    }

    if (parts.items.len == 0) {
        try parts.append('/');
    }

    return try parts.toOwnedSlice();
}

const bun = @import("bun");
const bake = bun.bake;
const strings = bun.strings;
const logger = bun.logger;
const Loc = logger.Loc;

const Route = bun.bake.FrameworkRouter.Route;
const SSRRouteList = bun.bake.SSRRouteList;

const jsc = bun.jsc;
const JSError = bun.JSError;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const E = bun.ast.E;

const DirInfo = bun.resolver.DirInfo;
const Resolver = bun.resolver.Resolver;

const mem = std.mem;
const Allocator = mem.Allocator;
const Manifest = bun.bake.Manifest;

const ServerConfig = bun.api.server.ServerConfig;
const AnyServer = bun.api.server.AnyServer;

const Output = bun.Output;
const FileRoute = bun.api.server.FileRoute;
const StaticRoute = bun.api.server.StaticRoute;

const Environment = bun.Environment;

const FrameworkRouter = bun.bake.FrameworkRouter;
const std = @import("std");
const uws = bun.uws;
