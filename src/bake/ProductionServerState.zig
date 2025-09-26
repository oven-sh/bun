const std = @import("std");

const Self = @This();

route_list: jsc.Strong,
bake_server_runtime_handler: jsc.Strong,
/// Pointer is owned by the arena inside Manifest
manifest: *bun.bake.Manifest,

pub fn router(this: *Self) *bun.bake.FrameworkRouter {
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

    const bake_server_runtime_handler = try initBakeServerRuntime(globalObject, server_runtime_path);

    const self: Self = .{
        .route_list = jsc.Strong.create(route_list, globalObject),
        .bake_server_runtime_handler = bake_server_runtime_handler,
        .manifest = manifest,
    };

    return bun.ptr.Owned(*Self).new(self);
}

pub fn initBakeServerRuntime(global: *JSGlobalObject, server_runtime_path: []const u8) !jsc.Strong {
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

    return jsc.Strong.create(handle_request_fn, global);
}

pub fn getRouteInfo(this: *Self, global: *JSGlobalObject, index: Route.Index) JSError!JSValue {
    return SSRRouteList.getRouteInfo(global, this.route_list.get(), index.get());
}

const SSRRouteList = struct {
    extern "C" fn Bun__BakeProductionSSRRouteList__create(globalObject: *JSGlobalObject, route_count: usize) JSValue;
    extern "C" fn Bun__BakeProductionSSRRouteList__getRouteInfo(globalObject: *JSGlobalObject, route_list_object: JSValue, index: usize) JSValue;

    pub fn create(globalObject: *JSGlobalObject, route_count: usize) JSError!JSValue {
        return jsc.fromJSHostCall(globalObject, @src(), Bun__BakeProductionSSRRouteList__create, .{ globalObject, route_count });
    }

    pub fn getRouteInfo(globalObject: *JSGlobalObject, route_list_object: JSValue, index: usize) JSError!JSValue {
        return jsc.fromJSHostCall(globalObject, @src(), Bun__BakeProductionSSRRouteList__getRouteInfo, .{ globalObject, route_list_object, index });
    }
};

fn BakeLoadProductionServerCode(global: *jsc.JSGlobalObject, code: bun.String, path: bun.String) bun.JSError!jsc.JSValue {
    const f = @extern(*const fn (*jsc.JSGlobalObject, bun.String, bun.String) callconv(.c) jsc.JSValue, .{ .name = "BakeLoadProductionServerCode" }).*;
    return bun.jsc.fromJSHostCall(global, @src(), f, .{ global, code, path });
}

/// Context type for FrameworkRouter in production mode
/// Implements the required methods for route scanning
pub const ProductionFrameworkRouter = struct {
    file_id_counter: u32 = 0,

    pub fn init() ProductionFrameworkRouter {
        return .{};
    }

    /// Generate a file ID for a route file
    /// In production, we don't need to track actual files since they're bundled
    pub fn getFileIdForRouter(
        this: *ProductionFrameworkRouter,
        abs_path: []const u8,
        associated_route: bun.bake.FrameworkRouter.Route.Index,
        file_kind: bun.bake.FrameworkRouter.Route.FileKind,
    ) !bun.bake.FrameworkRouter.OpaqueFileId {
        _ = abs_path;
        _ = associated_route;
        _ = file_kind;
        // In production, we just need unique IDs for the route structure
        // The actual files are already bundled
        const id = this.file_id_counter;
        this.file_id_counter += 1;
        return bun.bake.FrameworkRouter.OpaqueFileId.init(id);
    }

    /// Handle route syntax errors
    pub fn onRouterSyntaxError(
        this: *ProductionFrameworkRouter,
        rel_path: []const u8,
        log: bun.bake.FrameworkRouter.TinyLog,
    ) !void {
        _ = this;
        // In production, log syntax errors to console
        // These shouldn't happen in production as routes are pre-validated during build
        bun.Output.prettyErrorln("<r><red>error<r>: route syntax error in {s}", .{rel_path});
        log.print(rel_path);
        Output.flush();
    }

    /// Handle route collision errors
    pub fn onRouterCollisionError(
        this: *ProductionFrameworkRouter,
        rel_path: []const u8,
        other_id: bun.bake.FrameworkRouter.OpaqueFileId,
        file_kind: bun.bake.FrameworkRouter.Route.FileKind,
    ) !void {
        _ = this;
        _ = other_id;
        // In production, log collision errors
        // These shouldn't happen in production as routes are pre-validated during build
        Output.errGeneric("Multiple {s} matching the same route pattern is ambiguous", .{
            switch (file_kind) {
                .page => "pages",
                .layout => "layout",
            },
        });
        Output.prettyErrorln("  - <blue>{s}<r>", .{rel_path});
        Output.flush();
    }
};

pub fn routeDataForInitialization(
    globalObject: *JSGlobalObject,
    request: *bun.webcore.Request,
    router_index: usize,
    router_type_index: usize,
    out_router_type_main: *JSValue,
    out_route_modules: *JSValue,
    out_client_entry_url: *JSValue,
    out_styles: *JSValue,
) JSError!void {
    const server = request.request_context.getBakeProdState() orelse {
        return globalObject.throw("Request context is not a production server state", .{});
    };

    const rtr = server.router();

    if (router_index >= rtr.routes.items.len) {
        return globalObject.throw("Router index out of bounds", .{});
    }
    if (router_type_index >= rtr.types.len) {
        return globalObject.throw("Router type index out of bounds", .{});
    }

    const route = switch (server.manifest.routes[router_index]) {
        .ssr => |*ssr| ssr,
        else => {
            return globalObject.throw("Route is not an SSR route", .{});
        },
    };

    const router_type_main = bun.String.init(server.manifest.router_types[router_type_index].server_entrypoint);
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
    routerTypeIndex: usize,
    routerTypeMain: *JSValue,
    routeModules: *JSValue,
    clientEntryUrl: *JSValue,
    styles: *JSValue,
) callconv(jsc.conv) c_int {
    const request: *bun.webcore.Request = @ptrCast(@alignCast(zigRequestPtr));
    routeDataForInitialization(globalObject, request, routerIndex, routerTypeIndex, routerTypeMain, routeModules, clientEntryUrl, styles) catch |err| {
        if (err == error.OutOfMemory) bun.outOfMemory();
        return 0;
    };
    return 1;
}

const bun = @import("bun");
const bake = bun.bake;
const strings = bun.strings;
const logger = bun.logger;
const Loc = logger.Loc;

const Route = bun.bake.FrameworkRouter.Route;

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
const Output = bun.Output;
const Manifest = bun.bake.Manifest;

const FrameworkRouter = bun.bake.FrameworkRouter;
