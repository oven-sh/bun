const ServerConfig = @This();

address: union(enum) {
    tcp: struct {
        port: u16 = 0,
        hostname: ?[*:0]const u8 = null,
    },
    unix: [:0]const u8,

    pub fn deinit(this: *@This(), allocator: std.mem.Allocator) void {
        switch (this.*) {
            .tcp => |tcp| {
                if (tcp.hostname) |host| {
                    allocator.free(bun.sliceTo(host, 0));
                }
            },
            .unix => |addr| {
                allocator.free(addr);
            },
        }
        this.* = .{ .tcp = .{} };
    }
} = .{
    .tcp = .{},
},
idleTimeout: u8 = 10, //TODO: should we match websocket default idleTimeout of 120?
has_idleTimeout: bool = false,
// TODO: use webkit URL parser instead of bun's
base_url: URL = URL{},
base_uri: string = "",

ssl_config: ?SSLConfig = null,
sni: ?bun.BabyList(SSLConfig) = null,
max_request_body_size: usize = 1024 * 1024 * 128,
development: DevelopmentOption = .development,
broadcast_console_log_from_browser_to_server_for_bake: bool = false,

/// Enable automatic workspace folders for Chrome DevTools
/// https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
/// https://github.com/ChromeDevTools/vite-plugin-devtools-json/blob/76080b04422b36230d4b7a674b90d6df296cbff5/src/index.ts#L60-L77
///
/// If HMR is not enabled, then this field is ignored.
enable_chrome_devtools_automatic_workspace_folders: bool = true,

onError: jsc.JSValue = jsc.JSValue.zero,
onRequest: jsc.JSValue = jsc.JSValue.zero,
onNodeHTTPRequest: jsc.JSValue = jsc.JSValue.zero,

websocket: ?WebSocketServerContext = null,

inspector: bool = false,
reuse_port: bool = false,
id: []const u8 = "",
allow_hot: bool = true,
ipv6_only: bool = false,

is_node_http: bool = false,
had_routes_object: bool = false,

static_routes: std.array_list.Managed(StaticRouteEntry) = std.array_list.Managed(StaticRouteEntry).init(bun.default_allocator),
negative_routes: std.array_list.Managed([:0]const u8) = std.array_list.Managed([:0]const u8).init(bun.default_allocator),
user_routes_to_build: std.array_list.Managed(UserRouteBuilder) = std.array_list.Managed(UserRouteBuilder).init(bun.default_allocator),

bake: ?bun.bake.UserOptions = null,

pub const DevelopmentOption = enum {
    development,
    production,
    development_without_hmr,

    pub fn isHMREnabled(this: DevelopmentOption) bool {
        return this == .development;
    }

    pub fn isDevelopment(this: DevelopmentOption) bool {
        return this == .development or this == .development_without_hmr;
    }
};

pub fn isDevelopment(this: *const ServerConfig) bool {
    return this.development.isDevelopment();
}

pub fn memoryCost(this: *const ServerConfig) usize {
    // ignore @sizeOf(ServerConfig), assume already included.
    var cost: usize = 0;
    for (this.static_routes.items) |*entry| {
        cost += entry.memoryCost();
    }
    cost += this.id.len;
    cost += this.base_url.href.len;
    for (this.negative_routes.items) |route| {
        cost += route.len;
    }

    return cost;
}

// We need to be able to apply the route to multiple Apps even when there is only one RouteList.
pub const RouteDeclaration = struct {
    path: [:0]const u8 = "",
    method: union(enum) {
        any: void,
        specific: HTTP.Method,
    } = .any,

    pub fn deinit(this: *RouteDeclaration) void {
        if (this.path.len > 0) {
            bun.default_allocator.free(this.path);
        }
    }
};

// TODO: rename to StaticRoute.Entry
pub const StaticRouteEntry = struct {
    path: []const u8,
    route: AnyRoute,
    method: HTTP.Method.Optional = .any,

    pub fn memoryCost(this: *const StaticRouteEntry) usize {
        return this.path.len + this.route.memoryCost();
    }

    /// Clone the path buffer and increment the ref count
    /// This doesn't actually clone the route, it just increments the ref count
    pub fn clone(this: StaticRouteEntry) !StaticRouteEntry {
        this.route.ref();

        return .{
            .path = try bun.default_allocator.dupe(u8, this.path),
            .route = this.route,
            .method = this.method,
        };
    }

    pub fn deinit(this: *StaticRouteEntry) void {
        bun.default_allocator.free(this.path);
        this.path = "";
        this.route.deref();
        this.* = undefined;
    }

    pub fn isLessThan(_: void, this: StaticRouteEntry, other: StaticRouteEntry) bool {
        return strings.cmpStringsDesc({}, this.path, other.path);
    }
};

fn normalizeStaticRoutesList(this: *ServerConfig) !void {
    const Context = struct {
        // Ac
        pub fn hash(route: *StaticRouteEntry) u64 {
            var hasher = std.hash.Wyhash.init(0);
            switch (route.method) {
                .any => hasher.update("ANY"),
                .method => |*set| {
                    var iter = set.iterator();
                    while (iter.next()) |method| {
                        hasher.update(@tagName(method));
                    }
                },
            }
            hasher.update(route.path);
            return hasher.final();
        }
    };

    var static_routes_dedupe_list = std.array_list.Managed(u64).init(bun.default_allocator);
    try static_routes_dedupe_list.ensureTotalCapacity(@truncate(this.static_routes.items.len));
    defer static_routes_dedupe_list.deinit();

    // Iterate through the list of static routes backwards
    // Later ones added override earlier ones
    var list = &this.static_routes;
    if (list.items.len > 0) {
        var index = list.items.len - 1;
        while (true) {
            const route = &list.items[index];
            const hash = Context.hash(route);
            if (std.mem.indexOfScalar(u64, static_routes_dedupe_list.items, hash) != null) {
                var item = list.orderedRemove(index);
                item.deinit();
            } else {
                try static_routes_dedupe_list.append(hash);
            }

            if (index == 0) break;
            index -= 1;
        }
    }

    // sort the cloned static routes by name for determinism
    std.mem.sort(StaticRouteEntry, list.items, {}, StaticRouteEntry.isLessThan);
}

pub fn cloneForReloadingStaticRoutes(this: *ServerConfig) !ServerConfig {
    var that = this.*;
    this.ssl_config = null;
    this.sni = null;
    this.address = .{ .tcp = .{} };
    this.websocket = null;
    this.bake = null;

    try that.normalizeStaticRoutesList();

    return that;
}

pub fn appendStaticRoute(this: *ServerConfig, path: []const u8, route: AnyRoute, method: HTTP.Method.Optional) !void {
    try this.static_routes.append(StaticRouteEntry{
        .path = try bun.default_allocator.dupe(u8, path),
        .route = route,
        .method = method,
    });
}

pub fn applyStaticRoute(server: AnyServer, comptime ssl: bool, app: *uws.NewApp(ssl), comptime T: type, entry: T, path: []const u8, method: HTTP.Method.Optional) void {
    entry.server = server;
    const handler_wrap = struct {
        pub fn handler(route: T, req: *uws.Request, resp: *uws.NewApp(ssl).Response) void {
            route.onRequest(req, switch (comptime ssl) {
                true => .{ .SSL = resp },
                false => .{ .TCP = resp },
            });
        }

        pub fn HEAD(route: T, req: *uws.Request, resp: *uws.NewApp(ssl).Response) void {
            route.onHEADRequest(req, switch (comptime ssl) {
                true => .{ .SSL = resp },
                false => .{ .TCP = resp },
            });
        }
    };
    app.head(path, T, entry, handler_wrap.HEAD);
    switch (method) {
        .any => {
            app.any(path, T, entry, handler_wrap.handler);
        },
        .method => |*m| {
            var iter = m.iterator();
            while (iter.next()) |method_| {
                app.method(method_, path, T, entry, handler_wrap.handler);
            }
        },
    }
}

pub fn deinit(this: *ServerConfig) void {
    this.address.deinit(bun.default_allocator);

    for (this.negative_routes.items) |route| {
        bun.default_allocator.free(route);
    }
    this.negative_routes.clearAndFree();

    if (this.base_url.href.len > 0) {
        bun.default_allocator.free(this.base_url.href);
        this.base_url = URL{};
    }
    if (this.ssl_config) |*ssl_config| {
        ssl_config.deinit();
        this.ssl_config = null;
    }
    if (this.sni) |*sni| {
        for (sni.slice()) |*ssl_config| {
            ssl_config.deinit();
        }
        sni.deinit(bun.default_allocator);
        this.sni = null;
    }

    for (this.static_routes.items) |*entry| {
        entry.deinit();
    }
    this.static_routes.clearAndFree();

    if (this.bake) |*bake| {
        bake.deinit();
    }

    for (this.user_routes_to_build.items) |*builder| {
        builder.deinit();
    }
    this.user_routes_to_build.clearAndFree();
}

pub fn computeID(this: *const ServerConfig, allocator: std.mem.Allocator) []const u8 {
    var arraylist = std.array_list.Managed(u8).init(allocator);
    var writer = arraylist.writer();

    writer.writeAll("[http]-") catch {};
    switch (this.address) {
        .tcp => {
            if (this.address.tcp.hostname) |host| {
                writer.print("tcp:{s}:{d}", .{
                    bun.sliceTo(host, 0),
                    this.address.tcp.port,
                }) catch {};
            } else {
                writer.print("tcp:localhost:{d}", .{
                    this.address.tcp.port,
                }) catch {};
            }
        },
        .unix => {
            writer.print("unix:{s}", .{
                bun.sliceTo(this.address.unix, 0),
            }) catch {};
        },
    }

    return arraylist.items;
}

pub fn getUsocketsOptions(this: *const ServerConfig) i32 {
    // Unlike Node.js, we set exclusive port in case reuse port is not set
    var out: i32 = if (this.reuse_port)
        uws.LIBUS_LISTEN_REUSE_PORT | uws.LIBUS_LISTEN_REUSE_ADDR
    else
        uws.LIBUS_LISTEN_EXCLUSIVE_PORT;

    if (this.ipv6_only) {
        out |= uws.LIBUS_SOCKET_IPV6_ONLY;
    }

    return out;
}

fn validateRouteName(global: *jsc.JSGlobalObject, path: []const u8) !void {
    // Already validated by the caller
    bun.debugAssert(path.len > 0 and path[0] == '/');

    // For now, we don't support params that start with a number.
    // Mostly because it makes the params object more complicated to implement and it's easier to cut scope this way for now.
    var remaining = path;
    var duped_route_names = bun.StringHashMap(void).init(bun.default_allocator);
    defer duped_route_names.deinit();
    while (strings.indexOfChar(remaining, ':')) |index| {
        remaining = remaining[index + 1 ..];
        const end = strings.indexOfChar(remaining, '/') orelse remaining.len;
        const route_name = remaining[0..end];
        if (route_name.len > 0 and std.ascii.isDigit(route_name[0])) {
            return global.throwTODO(
                \\Route parameter names cannot start with a number.
                \\
                \\If you run into this, please file an issue and we will add support for it.
            );
        }

        const entry = bun.handleOom(duped_route_names.getOrPut(route_name));
        if (entry.found_existing) {
            return global.throwTODO(
                \\Support for duplicate route parameter names is not yet implemented.
                \\
                \\If you run into this, please file an issue and we will add support for it.
            );
        }

        remaining = remaining[end..];
    }
}

pub const SSLConfig = @import("./SSLConfig.zig");

fn getRoutesObject(global: *jsc.JSGlobalObject, arg: jsc.JSValue) bun.JSError!?jsc.JSValue {
    inline for (.{ "routes", "static" }) |key| {
        if (try arg.get(global, key)) |routes| {
            // https://github.com/oven-sh/bun/issues/17568
            if (routes.isArray()) {
                return null;
            }
            return routes;
        }
    }
    return null;
}

pub const FromJSOptions = struct {
    allow_bake_config: bool = true,
    is_fetch_required: bool = true,
    has_user_routes: bool = false,
};

pub fn fromJS(
    global: *jsc.JSGlobalObject,
    args: *ServerConfig,
    arguments: *jsc.CallFrame.ArgumentsSlice,
    opts: FromJSOptions,
) bun.JSError!void {
    const vm = arguments.vm;
    const env = vm.transpiler.env;

    args.* = .{
        .address = .{
            .tcp = .{
                .port = 3000,
                .hostname = null,
            },
        },
        .development = if (vm.transpiler.options.transform_options.serve_hmr) |hmr|
            if (!hmr) .development_without_hmr else .development
        else
            .development,

        // If this is a node:cluster child, let's default to SO_REUSEPORT.
        // That way you don't have to remember to set reusePort: true in Bun.serve() when using node:cluster.
        .reuse_port = env.get("NODE_UNIQUE_ID") != null,
    };
    var has_hostname = false;

    defer {
        if (!args.development.isHMREnabled()) {
            bun.assert(args.bake == null);
        }
    }

    if (strings.eqlComptime(env.get("NODE_ENV") orelse "", "production")) {
        args.development = .production;
    }

    if (arguments.vm.transpiler.options.production) {
        args.development = .production;
    }

    args.address.tcp.port = brk: {
        const PORT_ENV = .{ "BUN_PORT", "PORT", "NODE_PORT" };

        inline for (PORT_ENV) |PORT| {
            if (env.get(PORT)) |port| {
                if (std.fmt.parseInt(u16, port, 10)) |_port| {
                    break :brk _port;
                } else |_| {}
            }
        }

        if (arguments.vm.transpiler.options.transform_options.port) |port| {
            break :brk port;
        }

        break :brk args.address.tcp.port;
    };
    var port = args.address.tcp.port;

    if (arguments.vm.transpiler.options.transform_options.origin) |origin| {
        args.base_uri = try bun.default_allocator.dupeZ(u8, origin);
    }

    defer {
        if (global.hasException()) {
            if (args.ssl_config) |*conf| {
                conf.deinit();
                args.ssl_config = null;
            }
        }
    }

    if (arguments.next()) |arg| {
        if (!arg.isObject()) {
            return global.throwInvalidArguments("Bun.serve expects an object", .{});
        }

        // "development" impacts other settings like bake.
        if (try arg.get(global, "development")) |dev| {
            if (dev.isObject()) {
                if (try dev.getBooleanStrict(global, "hmr")) |hmr| {
                    args.development = if (!hmr) .development_without_hmr else .development;
                } else {
                    args.development = .development;
                }

                if (try dev.getBooleanStrict(global, "console")) |console| {
                    args.broadcast_console_log_from_browser_to_server_for_bake = console;
                }

                if (try dev.getBooleanStrict(global, "chromeDevToolsAutomaticWorkspaceFolders")) |enable_chrome_devtools_automatic_workspace_folders| {
                    args.enable_chrome_devtools_automatic_workspace_folders = enable_chrome_devtools_automatic_workspace_folders;
                }
            } else {
                args.development = if (dev.toBoolean()) .development else .production;
            }
            args.reuse_port = args.development == .production;
        }
        if (global.hasException()) return error.JSError;

        if (try getRoutesObject(global, arg)) |static| {
            const static_obj = static.getObject() orelse {
                return global.throwInvalidArguments(
                    \\Bun.serve() expects 'routes' to be an object shaped like:
                    \\
                    \\  {
                    \\    "/path": {
                    \\      GET: (req) => new Response("Hello"),
                    \\      POST: (req) => new Response("Hello"),
                    \\    },
                    \\    "/path2/:param": new Response("Hello"),
                    \\    "/path3/:param1/:param2": (req) => new Response("Hello")
                    \\  }
                    \\
                    \\Learn more at https://bun.com/docs/api/http
                , .{});
            };
            args.had_routes_object = true;

            var iter = try jsc.JSPropertyIterator(.{
                .skip_empty_name = true,
                .include_value = true,
            }).init(global, static_obj);
            defer iter.deinit();

            var init_ctx_: AnyRoute.ServerInitContext = .{
                .arena = .init(bun.default_allocator),
                .dedupe_html_bundle_map = .init(bun.default_allocator),
                .framework_router_list = .init(bun.default_allocator),
                .js_string_allocations = .empty,
                .user_routes = &args.static_routes,
                .global = global,
            };
            const init_ctx: *AnyRoute.ServerInitContext = &init_ctx_;
            errdefer {
                init_ctx.arena.deinit();
                init_ctx.framework_router_list.deinit();
            }
            // This list is not used in the success case
            defer init_ctx.dedupe_html_bundle_map.deinit();

            var framework_router_list = std.array_list.Managed(bun.bake.FrameworkRouter.Type).init(bun.default_allocator);
            errdefer framework_router_list.deinit();

            errdefer {
                for (args.static_routes.items) |*static_route| {
                    static_route.deinit();
                }
                args.static_routes.clearAndFree();
            }

            while (try iter.next()) |key| {
                const path, const is_ascii = bun.handleOom(key.toOwnedSliceReturningAllASCII(bun.default_allocator));
                errdefer bun.default_allocator.free(path);

                const value: jsc.JSValue = iter.value;

                if (value.isUndefined()) {
                    continue;
                }

                if (path.len == 0 or (path[0] != '/')) {
                    return global.throwInvalidArguments("Invalid route {f}. Path must start with '/'", .{bun.fmt.quote(path)});
                }

                if (!is_ascii) {
                    return global.throwInvalidArguments("Invalid route {f}. Please encode all non-ASCII characters in the path.", .{bun.fmt.quote(path)});
                }

                if (value == .false) {
                    const duped = bun.handleOom(bun.default_allocator.dupeZ(u8, path));
                    defer bun.default_allocator.free(path);
                    bun.handleOom(args.negative_routes.append(duped));
                    continue;
                }

                if (value.isCallable()) {
                    try validateRouteName(global, path);
                    args.user_routes_to_build.append(.{
                        .route = .{
                            .path = bun.handleOom(bun.default_allocator.dupeZ(u8, path)),
                            .method = .any,
                        },
                        .callback = .create(value.withAsyncContextIfNeeded(global), global),
                    }) catch |err| bun.handleOom(err);
                    bun.default_allocator.free(path);
                    continue;
                } else if (value.isObject()) {
                    const methods = .{
                        HTTP.Method.CONNECT,
                        HTTP.Method.DELETE,
                        HTTP.Method.GET,
                        HTTP.Method.HEAD,
                        HTTP.Method.OPTIONS,
                        HTTP.Method.PATCH,
                        HTTP.Method.POST,
                        HTTP.Method.PUT,
                        HTTP.Method.TRACE,
                    };
                    var found = false;
                    inline for (methods) |method| {
                        if (try value.getOwn(global, @tagName(method))) |function| {
                            if (!found) {
                                try validateRouteName(global, path);
                            }
                            found = true;

                            if (function.isCallable()) {
                                args.user_routes_to_build.append(.{
                                    .route = .{
                                        .path = bun.handleOom(bun.default_allocator.dupeZ(u8, path)),
                                        .method = .{ .specific = method },
                                    },
                                    .callback = .create(function.withAsyncContextIfNeeded(global), global),
                                }) catch |err| bun.handleOom(err);
                            } else if (try AnyRoute.fromJS(global, path, function, init_ctx)) |html_route| {
                                var method_set = bun.http.Method.Set.initEmpty();
                                method_set.insert(method);

                                args.static_routes.append(.{
                                    .path = bun.handleOom(bun.default_allocator.dupe(u8, path)),
                                    .route = html_route,
                                    .method = .{ .method = method_set },
                                }) catch |err| bun.handleOom(err);
                            }
                        }
                    }

                    if (found) {
                        bun.default_allocator.free(path);
                        continue;
                    }
                }

                const route = try AnyRoute.fromJS(global, path, value, init_ctx) orelse {
                    return global.throwInvalidArguments(
                        \\'routes' expects a Record<string, Response | HTMLBundle | {[method: string]: (req: BunRequest) => Response|Promise<Response>}>
                        \\
                        \\To bundle frontend apps on-demand with Bun.serve(), import HTML files.
                        \\
                        \\Example:
                        \\
                        \\```js
                        \\import { serve } from "bun";
                        \\import app from "./app.html";
                        \\
                        \\serve({
                        \\  routes: {
                        \\    "/index.json": Response.json({ message: "Hello World" }),
                        \\    "/app": app,
                        \\    "/path/:param": (req) => {
                        \\      const param = req.params.param;
                        \\      return Response.json({ message: `Hello ${param}` });
                        \\    },
                        \\    "/path": {
                        \\      GET(req) {
                        \\        return Response.json({ message: "Hello World" });
                        \\      },
                        \\      POST(req) {
                        \\        return Response.json({ message: "Hello World" });
                        \\      },
                        \\    },
                        \\  },
                        \\
                        \\  fetch(request) {
                        \\    return new Response("fallback response");
                        \\  },
                        \\});
                        \\```
                        \\
                        \\See https://bun.com/docs/api/http for more information.
                    ,
                        .{},
                    );
                };
                args.static_routes.append(.{
                    .path = path,
                    .route = route,
                }) catch |err| bun.handleOom(err);
            }

            // When HTML bundles are provided, ensure DevServer options are ready
            // The presence of these options causes Bun.serve to initialize things.
            if ((init_ctx.dedupe_html_bundle_map.count() > 0 or
                init_ctx.framework_router_list.items.len > 0))
            {
                if (args.development.isHMREnabled()) {
                    const root = bun.fs.FileSystem.instance.top_level_dir;
                    const framework = try bun.bake.Framework.auto(
                        init_ctx.arena.allocator(),
                        &global.bunVM().transpiler.resolver,
                        init_ctx.framework_router_list.items,
                    );
                    args.bake = .{
                        .arena = init_ctx.arena,
                        .allocations = init_ctx.js_string_allocations,
                        .root = root,
                        .framework = framework,
                        .bundler_options = bun.bake.SplitBundlerOptions.empty,
                    };
                    const bake = &args.bake.?;

                    const o = vm.transpiler.options.transform_options;

                    switch (o.serve_env_behavior) {
                        .prefix => {
                            bake.bundler_options.client.env_prefix = vm.transpiler.options.transform_options.serve_env_prefix;
                            bake.bundler_options.client.env = .prefix;
                        },
                        .load_all => {
                            bake.bundler_options.client.env = .load_all;
                        },
                        .disable => {
                            bake.bundler_options.client.env = .disable;
                        },
                        else => {},
                    }

                    if (o.serve_define) |define| {
                        bake.bundler_options.client.define = define;
                        bake.bundler_options.server.define = define;
                        bake.bundler_options.ssr.define = define;
                    }
                } else {
                    if (init_ctx.framework_router_list.items.len > 0) {
                        return global.throwInvalidArguments("FrameworkRouter is currently only supported when `development: true`", .{});
                    }
                    init_ctx.arena.deinit();
                }
            } else {
                bun.debugAssert(init_ctx.arena.state.end_index == 0 and
                    init_ctx.arena.state.buffer_list.first == null);
                init_ctx.arena.deinit();
            }
        }

        if (global.hasException()) return error.JSError;

        if (try arg.get(global, "idleTimeout")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isAnyInt()) {
                    return global.throwInvalidArguments("Bun.serve expects idleTimeout to be an integer", .{});
                }
                args.has_idleTimeout = true;

                const idleTimeout: u64 = @intCast(@max(value.toInt64(), 0));
                if (idleTimeout > 255) {
                    return global.throwInvalidArguments("Bun.serve expects idleTimeout to be 255 or less", .{});
                }

                args.idleTimeout = @truncate(idleTimeout);
            }
        }

        if (try arg.getTruthy(global, "webSocket") orelse try arg.getTruthy(global, "websocket")) |websocket_object| {
            if (!websocket_object.isObject()) {
                if (args.ssl_config) |*conf| {
                    conf.deinit();
                }
                return global.throwInvalidArguments("Expected websocket to be an object", .{});
            }

            errdefer if (args.ssl_config) |*conf| conf.deinit();
            args.websocket = try WebSocketServerContext.onCreate(global, websocket_object);
        }
        if (global.hasException()) return error.JSError;

        if (try arg.getTruthy(global, "port")) |port_| {
            args.address.tcp.port = @as(
                u16,
                @intCast(@min(
                    @max(0, try port_.coerce(i32, global)),
                    std.math.maxInt(u16),
                )),
            );
            port = args.address.tcp.port;
        }
        if (global.hasException()) return error.JSError;

        if (try arg.getTruthy(global, "baseURI")) |baseURI| {
            var sliced = try baseURI.toSlice(global, bun.default_allocator);

            if (sliced.len > 0) {
                defer sliced.deinit();
                if (args.base_uri.len > 0) {
                    bun.default_allocator.free(@constCast(args.base_uri));
                }
                args.base_uri = bun.default_allocator.dupe(u8, sliced.slice()) catch unreachable;
            }
        }
        if (global.hasException()) return error.JSError;

        if (try arg.getStringish(global, "hostname") orelse try arg.getStringish(global, "host")) |host| {
            defer host.deref();
            const host_str = host.toUTF8(bun.default_allocator);
            defer host_str.deinit();

            if (host_str.len > 0) {
                args.address.tcp.hostname = bun.default_allocator.dupeZ(u8, host_str.slice()) catch unreachable;
                has_hostname = true;
            }
        }
        if (global.hasException()) return error.JSError;

        if (try arg.getStringish(global, "unix")) |unix| {
            defer unix.deref();
            const unix_str = unix.toUTF8(bun.default_allocator);
            defer unix_str.deinit();
            if (unix_str.len > 0) {
                if (has_hostname) {
                    return global.throwInvalidArguments("Cannot specify both hostname and unix", .{});
                }

                args.address = .{ .unix = bun.default_allocator.dupeZ(u8, unix_str.slice()) catch unreachable };
            }
        }
        if (global.hasException()) return error.JSError;

        if (try arg.get(global, "id")) |id| {
            if (id.isUndefinedOrNull()) {
                args.allow_hot = false;
            } else {
                const id_str = try id.toUTF8Bytes(global, bun.default_allocator);
                if (id_str.len > 0) {
                    args.id = id_str;
                } else {
                    args.allow_hot = false;
                }
            }
        }
        if (global.hasException()) return error.JSError;

        if (opts.allow_bake_config) {
            if (try arg.getTruthy(global, "app")) |bake_args_js| brk: {
                if (!bun.FeatureFlags.bake()) {
                    break :brk;
                }
                if (args.bake != null) {
                    // "app" is likely to be removed in favor of the HTML loader.
                    return global.throwInvalidArguments("'app' + HTML loader not supported.", .{});
                }

                if (args.development == .production) {
                    return global.throwInvalidArguments("TODO: 'development: false' in serve options with 'app'. For now, use `bun build --app` or set 'development: true'", .{});
                }

                args.bake = try bun.bake.UserOptions.fromJS(bake_args_js, global);
            }
        }

        if (try arg.get(global, "reusePort")) |dev| {
            args.reuse_port = dev.toBoolean();
        }
        if (global.hasException()) return error.JSError;

        if (try arg.get(global, "ipv6Only")) |dev| {
            args.ipv6_only = dev.toBoolean();
        }
        if (global.hasException()) return error.JSError;

        if (try arg.get(global, "inspector")) |inspector| {
            args.inspector = inspector.toBoolean();

            if (args.inspector and args.development == .production) {
                return global.throwInvalidArguments("Cannot enable inspector in production. Please set development: true in Bun.serve()", .{});
            }
        }
        if (global.hasException()) return error.JSError;

        if (try arg.getTruthy(global, "maxRequestBodySize")) |max_request_body_size| {
            if (max_request_body_size.isNumber()) {
                args.max_request_body_size = @as(u64, @intCast(@max(0, max_request_body_size.toInt64())));
            }
        }
        if (global.hasException()) return error.JSError;

        if (try arg.getTruthyComptime(global, "error")) |onError| {
            if (!onError.isCallable()) {
                return global.throwInvalidArguments("Expected error to be a function", .{});
            }
            const onErrorSnapshot = onError.withAsyncContextIfNeeded(global);
            args.onError = onErrorSnapshot;
            onErrorSnapshot.protect();
        }
        if (global.hasException()) return error.JSError;

        if (try arg.getTruthy(global, "onNodeHTTPRequest")) |onRequest_| {
            if (!onRequest_.isCallable()) {
                return global.throwInvalidArguments("Expected onNodeHTTPRequest to be a function", .{});
            }
            const onRequest = onRequest_.withAsyncContextIfNeeded(global);
            onRequest.protect();
            args.onNodeHTTPRequest = onRequest;
        }

        if (try arg.getTruthy(global, "fetch")) |onRequest_| {
            if (!onRequest_.isCallable()) {
                return global.throwInvalidArguments("Expected fetch() to be a function", .{});
            }
            const onRequest = onRequest_.withAsyncContextIfNeeded(global);
            onRequest.protect();
            args.onRequest = onRequest;
        } else if (args.bake == null and args.onNodeHTTPRequest == .zero and ((args.static_routes.items.len + args.user_routes_to_build.items.len) == 0 and !opts.has_user_routes) and opts.is_fetch_required) {
            if (global.hasException()) return error.JSError;
            return global.throwInvalidArguments(
                \\Bun.serve() needs either:
                \\
                \\  - A routes object:
                \\     routes: {
                \\       "/path": {
                \\         GET: (req) => new Response("Hello")
                \\       }
                \\     }
                \\
                \\  - Or a fetch handler:
                \\     fetch: (req) => {
                \\       return new Response("Hello")
                \\     }
                \\
                \\Learn more at https://bun.com/docs/api/http
            , .{});
        } else {
            if (global.hasException()) return error.JSError;
        }

        if (try arg.getTruthy(global, "tls")) |tls| {
            if (tls.isFalsey()) {
                args.ssl_config = null;
            } else if (tls.jsType().isArray()) {
                var value_iter = try tls.arrayIterator(global);
                if (value_iter.len == 0) {
                    // Empty TLS array means no TLS - this is valid
                } else {
                    while (try value_iter.next()) |item| {
                        var ssl_config = try SSLConfig.fromJS(vm, global, item) orelse {
                            if (global.hasException()) {
                                return error.JSError;
                            }

                            // Backwards-compatibility; we ignored empty tls objects.
                            continue;
                        };

                        if (args.ssl_config == null) {
                            args.ssl_config = ssl_config;
                        } else {
                            if ((ssl_config.server_name orelse "")[0] == 0) {
                                defer ssl_config.deinit();
                                return global.throwInvalidArguments("SNI tls object must have a serverName", .{});
                            }
                            if (args.sni == null) {
                                args.sni = bun.handleOom(bun.BabyList(SSLConfig).initCapacity(bun.default_allocator, value_iter.len - 1));
                            }

                            bun.handleOom(args.sni.?.append(bun.default_allocator, ssl_config));
                        }
                    }
                }
            } else {
                if (try SSLConfig.fromJS(vm, global, tls)) |ssl_config| {
                    args.ssl_config = ssl_config;
                }
                if (global.hasException()) {
                    return error.JSError;
                }
            }
        }
        if (global.hasException()) return error.JSError;

        // @compatibility Bun v0.x - v0.2.1
        // this used to be top-level, now it's "tls" object
        if (args.ssl_config == null) {
            if (try SSLConfig.fromJS(vm, global, arg)) |ssl_config| {
                args.ssl_config = ssl_config;
            }
            if (global.hasException()) {
                return error.JSError;
            }
        }
    } else {
        return global.throwInvalidArguments("Bun.serve expects an object", .{});
    }

    if (args.base_uri.len > 0) {
        args.base_url = URL.parse(args.base_uri);
        if (args.base_url.hostname.len == 0) {
            bun.default_allocator.free(@constCast(args.base_uri));
            args.base_uri = "";
            return global.throwInvalidArguments("baseURI must have a hostname", .{});
        }

        if (!strings.isAllASCII(args.base_uri)) {
            bun.default_allocator.free(@constCast(args.base_uri));
            args.base_uri = "";
            return global.throwInvalidArguments("Unicode baseURI must already be encoded for now.\nnew URL(baseuRI).toString() should do the trick.", .{});
        }

        if (args.base_url.protocol.len == 0) {
            const protocol: string = if (args.ssl_config != null) "https" else "http";
            const hostname = args.base_url.hostname;
            const needsBrackets: bool = strings.isIPV6Address(hostname) and hostname[0] != '[';
            const original_base_uri = args.base_uri;
            defer bun.default_allocator.free(@constCast(original_base_uri));
            if (needsBrackets) {
                args.base_uri = (if ((port == 80 and args.ssl_config == null) or (port == 443 and args.ssl_config != null))
                    std.fmt.allocPrint(bun.default_allocator, "{s}://[{s}]/{s}", .{
                        protocol,
                        hostname,
                        strings.trimLeadingChar(args.base_url.pathname, '/'),
                    })
                else
                    std.fmt.allocPrint(bun.default_allocator, "{s}://[{s}]:{d}/{s}", .{
                        protocol,
                        hostname,
                        port,
                        strings.trimLeadingChar(args.base_url.pathname, '/'),
                    })) catch unreachable;
            } else {
                args.base_uri = (if ((port == 80 and args.ssl_config == null) or (port == 443 and args.ssl_config != null))
                    std.fmt.allocPrint(bun.default_allocator, "{s}://{s}/{s}", .{
                        protocol,
                        hostname,
                        strings.trimLeadingChar(args.base_url.pathname, '/'),
                    })
                else
                    std.fmt.allocPrint(bun.default_allocator, "{s}://{s}:{d}/{s}", .{
                        protocol,
                        hostname,
                        port,
                        strings.trimLeadingChar(args.base_url.pathname, '/'),
                    })) catch unreachable;
            }

            args.base_url = URL.parse(args.base_uri);
        }
    } else {
        const hostname: string =
            if (has_hostname) std.mem.span(args.address.tcp.hostname.?) else "0.0.0.0";

        const needsBrackets: bool = strings.isIPV6Address(hostname) and hostname[0] != '[';

        const protocol: string = if (args.ssl_config != null) "https" else "http";
        if (needsBrackets) {
            args.base_uri = (if ((port == 80 and args.ssl_config == null) or (port == 443 and args.ssl_config != null))
                std.fmt.allocPrint(bun.default_allocator, "{s}://[{s}]/", .{
                    protocol,
                    hostname,
                })
            else
                std.fmt.allocPrint(bun.default_allocator, "{s}://[{s}]:{d}/", .{ protocol, hostname, port })) catch unreachable;
        } else {
            args.base_uri = (if ((port == 80 and args.ssl_config == null) or (port == 443 and args.ssl_config != null))
                std.fmt.allocPrint(bun.default_allocator, "{s}://{s}/", .{
                    protocol,
                    hostname,
                })
            else
                std.fmt.allocPrint(bun.default_allocator, "{s}://{s}:{d}/", .{ protocol, hostname, port })) catch unreachable;
        }

        if (!strings.isAllASCII(hostname)) {
            bun.default_allocator.free(@constCast(args.base_uri));
            args.base_uri = "";
            return global.throwInvalidArguments("Unicode hostnames must already be encoded for now.\nnew URL(input).hostname should do the trick.", .{});
        }

        args.base_url = URL.parse(args.base_uri);
    }

    // I don't think there's a case where this can happen
    // but let's check anyway, just in case
    if (args.base_url.hostname.len == 0) {
        bun.default_allocator.free(@constCast(args.base_uri));
        args.base_uri = "";
        return global.throwInvalidArguments("baseURI must have a hostname", .{});
    }

    if (args.base_url.username.len > 0 or args.base_url.password.len > 0) {
        bun.default_allocator.free(@constCast(args.base_uri));
        args.base_uri = "";
        return global.throwInvalidArguments("baseURI can't have a username or password", .{});
    }

    return;
}

const UserRouteBuilder = struct {
    route: ServerConfig.RouteDeclaration,
    callback: jsc.Strong.Optional = .empty,

    pub fn deinit(this: *UserRouteBuilder) void {
        this.route.deinit();
        this.callback.deinit();
    }
};

const string = []const u8;

const WebSocketServerContext = @import("./WebSocketServerContext.zig");
const std = @import("std");

const bun = @import("bun");
const HTTP = bun.http;
const JSError = bun.JSError;
const URL = bun.URL;
const assert = bun.assert;
const jsc = bun.jsc;
const strings = bun.strings;
const uws = bun.uws;
const AnyRoute = bun.api.server.AnyRoute;
const AnyServer = jsc.API.AnyServer;
