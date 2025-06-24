const Bun = @This();
const default_allocator = bun.default_allocator;
const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const std = @import("std");
const Allocator = std.mem.Allocator;
const Sys = @import("../../sys.zig");

const logger = bun.logger;
const options = @import("../../options.zig");
const Transpiler = bun.Transpiler;
const js_printer = bun.js_printer;
const Analytics = @import("../../analytics/analytics_thread.zig");
const ZigString = bun.JSC.ZigString;
const Runtime = @import("../../runtime.zig");
const WebCore = bun.JSC.WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const HTTP = bun.http;
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const host_fn = JSC.host_fn;

const JSGlobalObject = bun.JSC.JSGlobalObject;
const Node = bun.JSC.Node;
const JSPromise = bun.JSC.JSPromise;
const VM = bun.JSC.VM;
const URL = @import("../../url.zig").URL;
const VirtualMachine = JSC.VirtualMachine;
const uws = bun.uws;
const Fallback = Runtime.Fallback;
const MimeType = HTTP.MimeType;
const Blob = JSC.WebCore.Blob;
const BoringSSL = bun.BoringSSL.c;
const Arena = @import("../../allocators/mimalloc_arena.zig").Arena;

const Async = bun.Async;
const httplog = Output.scoped(.Server, false);
const ctxLog = Output.scoped(.RequestContext, false);
const SocketAddress = @import("bun/socket.zig").SocketAddress;

pub const WebSocketServerContext = @import("./server/WebSocketServerContext.zig");
pub const HTTPStatusText = @import("./server/HTTPStatusText.zig");

pub fn writeStatus(comptime ssl: bool, resp_ptr: ?*uws.NewApp(ssl).Response, status: u16) void {
    if (resp_ptr) |resp| {
        if (HTTPStatusText.get(status)) |text| {
            resp.writeStatus(text);
        } else {
            var status_text_buf: [48]u8 = undefined;
            resp.writeStatus(std.fmt.bufPrint(&status_text_buf, "{d} HM", .{status}) catch unreachable);
        }
    }
}

// TODO: rename to StaticBlobRoute? the html bundle is sometimes a static route
pub const StaticRoute = @import("./server/StaticRoute.zig");
pub const FileRoute = @import("./server/FileRoute.zig");

const HTMLBundle = JSC.API.HTMLBundle;

pub const AnyRoute = union(enum) {
    /// Serve a static file
    /// "/robots.txt": new Response(...),
    static: *StaticRoute,
    /// Serve a file from disk
    file: *FileRoute,
    /// Bundle an HTML import
    /// import html from "./index.html";
    /// "/": html,
    html: bun.ptr.RefPtr(HTMLBundle.Route),
    /// Use file system routing.
    /// "/*": {
    ///   "dir": import.meta.resolve("./pages"),
    ///   "style": "nextjs-pages",
    /// }
    framework_router: bun.bake.FrameworkRouter.Type.Index,

    pub fn memoryCost(this: AnyRoute) usize {
        return switch (this) {
            .static => |static_route| static_route.memoryCost(),
            .file => |file_route| file_route.memoryCost(),
            .html => |html_bundle_route| html_bundle_route.data.memoryCost(),
            .framework_router => @sizeOf(bun.bake.Framework.FileSystemRouterType),
        };
    }

    pub fn setServer(this: AnyRoute, server: ?AnyServer) void {
        switch (this) {
            .static => |static_route| static_route.server = server,
            .file => |file_route| file_route.server = server,
            .html => |html_bundle_route| html_bundle_route.server = server,
            .framework_router => {}, // DevServer contains .server field
        }
    }

    pub fn deref(this: AnyRoute) void {
        switch (this) {
            .static => |static_route| static_route.deref(),
            .file => |file_route| file_route.deref(),
            .html => |html_bundle_route| html_bundle_route.deref(),
            .framework_router => {}, // not reference counted
        }
    }

    pub fn ref(this: AnyRoute) void {
        switch (this) {
            .static => |static_route| static_route.ref(),
            .file => |file_route| file_route.ref(),
            .html => |html_bundle_route| html_bundle_route.ref(),
            .framework_router => {}, // not reference counted
        }
    }

    fn bundledHTMLManifestItemFromJS(argument: JSC.JSValue, index_path: []const u8, init_ctx: *ServerInitContext) bun.JSError!?AnyRoute {
        if (!argument.isObject()) return null;

        const path_string = try bun.String.fromJS(try argument.get(init_ctx.global, "path") orelse return null, init_ctx.global);
        defer path_string.deref();
        var path = JSC.Node.PathOrFileDescriptor{ .path = try JSC.Node.PathLike.fromBunString(init_ctx.global, path_string, false, bun.default_allocator) };
        defer path.deinit();

        // Construct the route by stripping paths above the root.
        //
        //    "./index-abc.js" -> "/index-abc.js"
        //    "../index-abc.js" -> "/index-abc.js"
        //    "/index-abc.js" -> "/index-abc.js"
        //    "index-abc.js" -> "/index-abc.js"
        //
        const cwd = if (bun.StandaloneModuleGraph.isBunStandaloneFilePath(path.path.slice()))
            bun.StandaloneModuleGraph.targetBasePublicPath(bun.Environment.os, "root/")
        else
            bun.fs.FileSystem.instance.top_level_dir;

        const abs_path = bun.fs.FileSystem.instance.abs(&[_][]const u8{path.path.slice()});
        var relative_path = bun.fs.FileSystem.instance.relative(cwd, abs_path);

        if (strings.hasPrefixComptime(relative_path, "./")) {
            relative_path = relative_path[2..];
        } else if (strings.hasPrefixComptime(relative_path, "../")) {
            while (strings.hasPrefixComptime(relative_path, "../")) {
                relative_path = relative_path[3..];
            }
        }
        const is_index_route = bun.strings.eql(path.path.slice(), index_path);
        var builder = std.ArrayList(u8).init(bun.default_allocator);
        defer builder.deinit();
        if (!strings.hasPrefixComptime(relative_path, "/")) {
            try builder.append('/');
        }

        try builder.appendSlice(relative_path);

        const fetch_headers = JSC.WebCore.FetchHeaders.createFromJS(init_ctx.global, try argument.get(init_ctx.global, "headers") orelse return null);
        defer if (fetch_headers) |headers| headers.deref();
        if (init_ctx.global.hasException()) return error.JSError;

        const route = try fromOptions(init_ctx.global, fetch_headers, &path);

        if (is_index_route) {
            return route;
        }

        var methods = HTTP.Method.Optional{ .method = .initEmpty() };
        methods.insert(.GET);
        methods.insert(.HEAD);

        try init_ctx.user_routes.append(.{
            .path = try builder.toOwnedSlice(),
            .route = route,
            .method = methods,
        });
        return null;
    }

    /// This is the JS representation of an HTMLImportManifest
    ///
    /// See ./src/bundler/HTMLImportManifest.zig
    fn bundledHTMLManifestFromJS(argument: JSC.JSValue, init_ctx: *ServerInitContext) bun.JSError!?AnyRoute {
        if (!argument.isObject()) return null;

        const index = try argument.getOptional(init_ctx.global, "index", ZigString.Slice) orelse return null;
        defer index.deinit();

        const files = try argument.getArray(init_ctx.global, "files") orelse return null;
        var iter = try files.arrayIterator(init_ctx.global);
        var html_route: ?AnyRoute = null;
        while (try iter.next()) |file_entry| {
            if (try bundledHTMLManifestItemFromJS(file_entry, index.slice(), init_ctx)) |item| {
                html_route = item;
            }
        }

        return html_route;
    }

    pub fn fromOptions(global: *JSC.JSGlobalObject, headers: ?*JSC.WebCore.FetchHeaders, path: *JSC.Node.PathOrFileDescriptor) !AnyRoute {
        // The file/static route doesn't ref it.
        var blob = Blob.findOrCreateFileFromPath(path, global, false);

        if (blob.needsToReadFile()) {
            // Throw a more helpful error upfront if the file does not exist.
            //
            // In production, you do NOT want to find out that all the assets
            // are 404'ing when the user goes to the route. You want to find
            // that out immediately so that the health check on startup fails
            // and the process exits with a non-zero status code.
            if (blob.store) |store| {
                if (store.getPath()) |store_path| {
                    switch (bun.sys.existsAtType(bun.FD.cwd(), store_path)) {
                        .result => |file_type| {
                            if (file_type == .directory) {
                                return global.throwInvalidArguments("Bundled file {} cannot be a directory. You may want to configure --asset-naming or `naming` when bundling.", .{bun.fmt.quote(store_path)});
                            }
                        },
                        .err => {
                            return global.throwInvalidArguments("Bundled file {} not found. You may want to configure --asset-naming or `naming` when bundling.", .{bun.fmt.quote(store_path)});
                        },
                    }
                }
            }

            return AnyRoute{ .file = FileRoute.initFromBlob(blob, .{ .server = null, .headers = headers }) };
        }

        return AnyRoute{ .static = StaticRoute.initFromAnyBlob(&.{ .Blob = blob }, .{ .server = null, .headers = headers }) };
    }

    pub fn htmlRouteFromJS(argument: JSC.JSValue, init_ctx: *ServerInitContext) bun.JSError!?AnyRoute {
        if (argument.as(HTMLBundle)) |html_bundle| {
            const entry = init_ctx.dedupe_html_bundle_map.getOrPut(html_bundle) catch bun.outOfMemory();
            if (!entry.found_existing) {
                entry.value_ptr.* = HTMLBundle.Route.init(html_bundle);
                return .{ .html = entry.value_ptr.* };
            } else {
                return .{ .html = entry.value_ptr.dupeRef() };
            }
        }

        if (try bundledHTMLManifestFromJS(argument, init_ctx)) |html_route| {
            return html_route;
        }

        return null;
    }

    pub const ServerInitContext = struct {
        arena: std.heap.ArenaAllocator,
        dedupe_html_bundle_map: std.AutoHashMap(*HTMLBundle, bun.ptr.RefPtr(HTMLBundle.Route)),
        js_string_allocations: bun.bake.StringRefList,
        global: *JSC.JSGlobalObject,
        framework_router_list: std.ArrayList(bun.bake.Framework.FileSystemRouterType),
        user_routes: *std.ArrayList(ServerConfig.StaticRouteEntry),
    };

    pub fn fromJS(
        global: *JSC.JSGlobalObject,
        path: []const u8,
        argument: JSC.JSValue,
        init_ctx: *ServerInitContext,
    ) bun.JSError!?AnyRoute {
        if (try AnyRoute.htmlRouteFromJS(argument, init_ctx)) |html_route| {
            return html_route;
        }

        if (argument.isObject()) {
            const FrameworkRouter = bun.bake.FrameworkRouter;
            if (try argument.getOptional(global, "dir", bun.String.Slice)) |dir| {
                var alloc = init_ctx.js_string_allocations;
                const relative_root = alloc.track(dir);

                var style: FrameworkRouter.Style = if (try argument.get(global, "style")) |style|
                    try FrameworkRouter.Style.fromJS(style, global)
                else
                    .nextjs_pages;
                errdefer style.deinit();

                if (!bun.strings.endsWith(path, "/*")) {
                    return global.throwInvalidArguments("To mount a directory, make sure the path ends in `/*`", .{});
                }

                try init_ctx.framework_router_list.append(.{
                    .root = relative_root,
                    .style = style,

                    // trim the /*
                    .prefix = if (path.len == 2) "/" else path[0 .. path.len - 2],

                    // TODO: customizable framework option.
                    .entry_client = "bun-framework-react/client.tsx",
                    .entry_server = "bun-framework-react/server.tsx",
                    .ignore_underscores = true,
                    .ignore_dirs = &.{ "node_modules", ".git" },
                    .extensions = &.{ ".tsx", ".jsx" },
                    .allow_layouts = true,
                });

                const limit = std.math.maxInt(@typeInfo(FrameworkRouter.Type.Index).@"enum".tag_type);
                if (init_ctx.framework_router_list.items.len > limit) {
                    return global.throwInvalidArguments("Too many framework routers. Maximum is {d}.", .{limit});
                }
                return .{ .framework_router = .init(@intCast(init_ctx.framework_router_list.items.len - 1)) };
            }
        }

        if (try FileRoute.fromJS(global, argument)) |file_route| {
            return .{ .file = file_route };
        }
        return .{ .static = try StaticRoute.fromJS(global, argument) orelse return null };
    }
};

pub const ServerConfig = @import("./server/ServerConfig.zig");
pub const ServerWebSocket = @import("./server/ServerWebSocket.zig");
pub const NodeHTTPResponse = @import("./server/NodeHTTPResponse.zig");

/// State machine to handle loading plugins asynchronously. This structure is not thread-safe.
const ServePlugins = struct {
    state: State,
    ref_count: RefCount,

    /// Reference count is incremented while there are other objects that are waiting on plugin loads.
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    pub const State = union(enum) {
        unqueued: []const []const u8,
        pending: struct {
            /// Promise may be empty if the plugin load finishes synchronously.
            plugin: *bun.JSC.API.JSBundler.Plugin,
            promise: JSC.JSPromise.Strong,
            html_bundle_routes: std.ArrayListUnmanaged(*HTMLBundle.Route),
            dev_server: ?*bun.bake.DevServer,
        },
        loaded: *bun.JSC.API.JSBundler.Plugin,
        /// Error information is not stored as it is already reported.
        err,
    };

    pub const GetOrStartLoadResult = union(enum) {
        /// null = no plugins, used by server implementation
        ready: ?*bun.JSC.API.JSBundler.Plugin,
        pending,
        err,
    };

    pub const Callback = union(enum) {
        html_bundle_route: *HTMLBundle.Route,
        dev_server: *bun.bake.DevServer,
    };

    pub fn init(plugins: []const []const u8) *ServePlugins {
        return bun.new(ServePlugins, .{ .ref_count = .init(), .state = .{ .unqueued = plugins } });
    }

    fn deinit(this: *ServePlugins) void {
        switch (this.state) {
            .unqueued => {},
            .pending => assert(false), // should have one ref while pending!
            .loaded => |loaded| loaded.deinit(),
            .err => {},
        }
        bun.destroy(this);
    }

    pub fn getOrStartLoad(this: *ServePlugins, global: *JSC.JSGlobalObject, cb: Callback) bun.JSError!GetOrStartLoadResult {
        sw: switch (this.state) {
            .unqueued => {
                try this.loadAndResolvePlugins(global);
                continue :sw this.state; // could jump to any branch if synchronously resolved
            },
            .pending => |*pending| {
                switch (cb) {
                    .html_bundle_route => |route| {
                        route.ref();
                        try pending.html_bundle_routes.append(bun.default_allocator, route);
                    },
                    .dev_server => |server| {
                        assert(pending.dev_server == null or pending.dev_server == server); // one dev server per server
                        pending.dev_server = server;
                    },
                }
                return .pending;
            },
            .loaded => |plugins| return .{ .ready = plugins },
            .err => return .err,
        }
    }

    extern fn JSBundlerPlugin__loadAndResolvePluginsForServe(
        plugin: *bun.JSC.API.JSBundler.Plugin,
        plugins: JSC.JSValue,
        bunfig_folder: JSC.JSValue,
    ) JSValue;

    fn loadAndResolvePlugins(this: *ServePlugins, global: *JSC.JSGlobalObject) bun.JSError!void {
        bun.assert(this.state == .unqueued);
        const plugin_list = this.state.unqueued;
        const bunfig_folder = bun.path.dirname(global.bunVM().transpiler.options.bunfig_path, .auto);

        this.ref();
        defer this.deref();

        const plugin = bun.JSC.API.JSBundler.Plugin.create(global, .browser);
        var sfb = std.heap.stackFallback(@sizeOf(bun.String) * 4, bun.default_allocator);
        const alloc = sfb.get();
        const bunstring_array = alloc.alloc(bun.String, plugin_list.len) catch bun.outOfMemory();
        defer alloc.free(bunstring_array);
        for (plugin_list, bunstring_array) |raw_plugin, *out| {
            out.* = bun.String.init(raw_plugin);
        }
        const plugin_js_array = try bun.String.toJSArray(global, bunstring_array);
        const bunfig_folder_bunstr = bun.String.createUTF8ForJS(global, bunfig_folder);

        this.state = .{ .pending = .{
            .promise = JSC.JSPromise.Strong.init(global),
            .plugin = plugin,
            .html_bundle_routes = .empty,
            .dev_server = null,
        } };

        global.bunVM().eventLoop().enter();
        const result = JSBundlerPlugin__loadAndResolvePluginsForServe(plugin, plugin_js_array, bunfig_folder_bunstr);
        global.bunVM().eventLoop().exit();

        // handle the case where js synchronously throws an error
        if (global.tryTakeException()) |e| {
            handleOnReject(this, global, e);
            return;
        }

        if (!result.isEmptyOrUndefinedOrNull()) {
            // handle the case where js returns a promise
            if (result.asAnyPromise()) |promise| {
                switch (promise.status(global.vm())) {
                    // promise not fulfilled yet
                    .pending => {
                        this.ref();
                        const promise_value = promise.asValue();
                        this.state.pending.promise.strong.set(global, promise_value);
                        promise_value.then(global, this, onResolveImpl, onRejectImpl);
                        return;
                    },
                    .fulfilled => {
                        handleOnResolve(this);
                        return;
                    },
                    .rejected => {
                        const value = promise.result(global.vm());
                        handleOnReject(this, global, value);
                        return;
                    },
                }
            }

            if (result.toError()) |e| {
                handleOnReject(this, global, e);
            } else {
                handleOnResolve(this);
            }
        }
    }

    pub const onResolve = JSC.toJSHostFn(onResolveImpl);
    pub const onReject = JSC.toJSHostFn(onRejectImpl);

    pub fn onResolveImpl(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        ctxLog("onResolve", .{});

        const plugins_result, const plugins_js = callframe.argumentsAsArray(2);
        var plugins = plugins_js.asPromisePtr(ServePlugins);
        defer plugins.deref();
        plugins_result.ensureStillAlive();

        handleOnResolve(plugins);

        return .js_undefined;
    }

    pub fn handleOnResolve(this: *ServePlugins) void {
        bun.assert(this.state == .pending);
        const pending = &this.state.pending;
        const plugin = pending.plugin;
        var html_bundle_routes = pending.html_bundle_routes;
        pending.html_bundle_routes = .empty;
        defer html_bundle_routes.deinit(bun.default_allocator);

        pending.promise.deinit();

        this.state = .{ .loaded = plugin };

        for (html_bundle_routes.items) |route| {
            route.onPluginsResolved(plugin) catch bun.outOfMemory();
            route.deref();
        }
        if (pending.dev_server) |server| {
            server.onPluginsResolved(plugin) catch bun.outOfMemory();
        }
    }

    pub fn onRejectImpl(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        ctxLog("onReject", .{});

        const error_js, const plugin_js = callframe.argumentsAsArray(2);
        const plugins = plugin_js.asPromisePtr(ServePlugins);
        handleOnReject(plugins, globalThis, error_js);

        return .js_undefined;
    }

    pub fn handleOnReject(this: *ServePlugins, global: *JSC.JSGlobalObject, err: JSValue) void {
        bun.assert(this.state == .pending);
        const pending = &this.state.pending;
        var html_bundle_routes = pending.html_bundle_routes;
        pending.html_bundle_routes = .empty;
        defer html_bundle_routes.deinit(bun.default_allocator);
        pending.plugin.deinit();
        pending.promise.deinit();

        this.state = .err;

        for (html_bundle_routes.items) |route| {
            route.onPluginsRejected() catch bun.outOfMemory();
            route.deref();
        }
        if (pending.dev_server) |server| {
            server.onPluginsRejected() catch bun.outOfMemory();
        }

        Output.errGeneric("Failed to load plugins for Bun.serve:", .{});
        global.bunVM().runErrorHandler(err, null);
    }

    comptime {
        @export(&onResolve, .{ .name = "BunServe__onResolvePlugins" });
        @export(&onReject, .{ .name = "BunServe__onRejectPlugins" });
    }
};

const PluginsResult = union(enum) {
    pending,
    found: ?*bun.JSC.API.JSBundler.Plugin,
    err,
};

pub fn NewServer(protocol_enum: enum { http, https }, development_kind: enum { debug, production }) type {
    return struct {
        pub const js = switch (protocol_enum) {
            .http => switch (development_kind) {
                .debug => bun.JSC.Codegen.JSDebugHTTPServer,
                .production => bun.JSC.Codegen.JSHTTPServer,
            },
            .https => switch (development_kind) {
                .debug => bun.JSC.Codegen.JSDebugHTTPSServer,
                .production => bun.JSC.Codegen.JSHTTPSServer,
            },
        };
        pub const fromJS = js.fromJS;
        pub const toJS = js.toJS;
        pub const toJSDirect = js.toJSDirect;

        pub const new = bun.TrivialNew(@This());

        pub const ssl_enabled = protocol_enum == .https;
        pub const debug_mode = development_kind == .debug;

        const ThisServer = @This();
        pub const RequestContext = NewRequestContext(ssl_enabled, debug_mode, @This());

        pub const App = uws.NewApp(ssl_enabled);
        app: ?*App = null,
        listener: ?*App.ListenSocket = null,
        js_value: JSC.Strong.Optional = .empty,
        /// Potentially null before listen() is called, and once .destroy() is called.
        vm: *JSC.VirtualMachine,
        globalThis: *JSGlobalObject,
        base_url_string_for_joining: string = "",
        config: ServerConfig = ServerConfig{},
        pending_requests: usize = 0,
        request_pool_allocator: *RequestContext.RequestContextStackAllocator = undefined,
        all_closed_promise: JSC.JSPromise.Strong = .{},

        listen_callback: JSC.AnyTask = undefined,
        allocator: std.mem.Allocator,
        poll_ref: Async.KeepAlive = .{},

        cached_hostname: bun.String = bun.String.empty,

        flags: packed struct(u4) {
            deinit_scheduled: bool = false,
            terminated: bool = false,
            has_js_deinited: bool = false,
            has_handled_all_closed_promise: bool = false,
        } = .{},

        plugins: ?*ServePlugins = null,

        dev_server: ?*bun.bake.DevServer,

        /// These associate a route to the index in RouteList.cpp.
        /// User routes may get applied multiple times due to SNI.
        /// So we have to store it.
        user_routes: std.ArrayListUnmanaged(UserRoute) = .{},

        on_clienterror: JSC.Strong.Optional = .empty,

        inspector_server_id: JSC.Debugger.DebuggerId = .init(0),

        pub const doStop = host_fn.wrapInstanceMethod(ThisServer, "stopFromJS", false);
        pub const dispose = host_fn.wrapInstanceMethod(ThisServer, "disposeFromJS", false);
        pub const doUpgrade = host_fn.wrapInstanceMethod(ThisServer, "onUpgrade", false);
        pub const doPublish = host_fn.wrapInstanceMethod(ThisServer, "publish", false);
        pub const doReload = onReload;
        pub const doFetch = onFetch;
        pub const doRequestIP = host_fn.wrapInstanceMethod(ThisServer, "requestIP", false);
        pub const doTimeout = timeout;

        pub const UserRoute = struct {
            id: u32,
            server: *ThisServer,
            route: ServerConfig.RouteDeclaration,

            pub fn deinit(this: *UserRoute) void {
                this.route.deinit();
            }
        };

        /// Returns:
        /// - .ready if no plugin has to be loaded
        /// - .err if there is a cached failure. Currently, this requires restarting the entire server.
        /// - .pending if `callback` was stored. It will call `onPluginsResolved` or `onPluginsRejected` later.
        pub fn getOrLoadPlugins(server: *ThisServer, callback: ServePlugins.Callback) ServePlugins.GetOrStartLoadResult {
            if (server.plugins) |p| {
                return p.getOrStartLoad(server.globalThis, callback) catch bun.outOfMemory();
            }
            // no plugins
            return .{ .ready = null };
        }

        pub fn doSubscriberCount(this: *ThisServer, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments = callframe.arguments_old(1);
            if (arguments.len < 1) {
                return globalThis.throwNotEnoughArguments("subscriberCount", 1, 0);
            }

            if (arguments.ptr[0].isEmptyOrUndefinedOrNull()) {
                return globalThis.throwInvalidArguments("subscriberCount requires a topic name as a string", .{});
            }

            var topic = try arguments.ptr[0].toSlice(globalThis, bun.default_allocator);
            defer topic.deinit();

            if (topic.len == 0) {
                return JSValue.jsNumber(0);
            }

            return JSValue.jsNumber((this.app.?.numSubscribers(topic.slice())));
        }

        pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!*ThisServer {
            return globalThis.throw2("Server() is not a constructor", .{});
        }

        pub fn jsValueAssertAlive(server: *ThisServer) JSC.JSValue {
            bun.debugAssert(server.listener != null); // this assertion is only valid while listening
            return server.js_value.get() orelse brk: {
                bun.debugAssert(false);
                break :brk .js_undefined; // safe-ish
            };
        }

        pub fn requestIP(this: *ThisServer, request: *JSC.WebCore.Request) JSC.JSValue {
            if (this.config.address == .unix) return JSValue.jsNull();
            const info = request.request_context.getRemoteSocketInfo() orelse return JSValue.jsNull();
            return SocketAddress.createDTO(this.globalThis, info.ip, @intCast(info.port), info.is_ipv6);
        }

        pub fn memoryCost(this: *ThisServer) usize {
            return @sizeOf(ThisServer) +
                this.base_url_string_for_joining.len +
                this.config.memoryCost() +
                (if (this.dev_server) |dev| dev.memoryCost() else 0);
        }

        pub fn timeout(this: *ThisServer, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments = callframe.arguments_old(2).slice();
            if (arguments.len < 2 or arguments[0].isEmptyOrUndefinedOrNull()) {
                return globalObject.throwNotEnoughArguments("timeout", 2, arguments.len);
            }

            const seconds = arguments[1];

            if (this.config.address == .unix) {
                return JSValue.jsNull();
            }

            if (!seconds.isNumber()) {
                return this.globalThis.throw("timeout() requires a number", .{});
            }
            const value = seconds.to(c_uint);

            if (arguments[0].as(Request)) |request| {
                _ = request.request_context.setTimeout(value);
            } else if (arguments[0].as(NodeHTTPResponse)) |response| {
                response.setTimeout(@truncate(value % 255));
            } else {
                return this.globalThis.throwInvalidArguments("timeout() requires a Request object", .{});
            }

            return .js_undefined;
        }

        pub fn setIdleTimeout(this: *ThisServer, seconds: c_uint) void {
            this.config.idleTimeout = @truncate(@min(seconds, 255));
        }

        pub fn setFlags(this: *ThisServer, require_host_header: bool, use_strict_method_validation: bool) void {
            if (this.app) |app| {
                app.setFlags(require_host_header, use_strict_method_validation);
            }
        }

        pub fn setMaxHTTPHeaderSize(this: *ThisServer, max_header_size: u64) void {
            if (this.app) |app| {
                app.setMaxHTTPHeaderSize(max_header_size);
            }
        }

        pub fn appendStaticRoute(this: *ThisServer, path: []const u8, route: AnyRoute, method: HTTP.Method.Optional) !void {
            try this.config.appendStaticRoute(path, route, method);
        }

        pub fn publish(this: *ThisServer, globalThis: *JSC.JSGlobalObject, topic: ZigString, message_value: JSValue, compress_value: ?JSValue) bun.JSError!JSValue {
            if (this.config.websocket == null)
                return JSValue.jsNumber(0);

            const app = this.app.?;

            if (topic.len == 0) {
                httplog("publish() topic invalid", .{});
                return globalThis.throw("publish requires a topic string", .{});
            }

            var topic_slice = topic.toSlice(bun.default_allocator);
            defer topic_slice.deinit();
            if (topic_slice.len == 0) {
                return globalThis.throw("publish requires a non-empty topic", .{});
            }

            const compress = (compress_value orelse JSValue.jsBoolean(true)).toBoolean();

            if (message_value.asArrayBuffer(globalThis)) |buffer| {
                return JSValue.jsNumber(
                    // if 0, return 0
                    // else return number of bytes sent
                    @as(i32, @intFromBool(uws.AnyWebSocket.publishWithOptions(ssl_enabled, app, topic_slice.slice(), buffer.slice(), .binary, compress))) * @as(i32, @intCast(@as(u31, @truncate(buffer.len)))),
                );
            }

            {
                var js_string = message_value.toString(globalThis);
                if (globalThis.hasException()) {
                    return .zero;
                }
                const view = js_string.view(globalThis);
                const slice = view.toSlice(bun.default_allocator);
                defer slice.deinit();

                defer js_string.ensureStillAlive();

                const buffer = slice.slice();
                return JSValue.jsNumber(
                    // if 0, return 0
                    // else return number of bytes sent
                    @as(i32, @intFromBool(uws.AnyWebSocket.publishWithOptions(ssl_enabled, app, topic_slice.slice(), buffer, .text, compress))) * @as(i32, @intCast(@as(u31, @truncate(buffer.len)))),
                );
            }
        }

        pub fn onUpgrade(
            this: *ThisServer,
            globalThis: *JSC.JSGlobalObject,
            object: JSC.JSValue,
            optional: ?JSValue,
        ) bun.JSError!JSValue {
            if (this.config.websocket == null) {
                return globalThis.throwInvalidArguments("To enable websocket support, set the \"websocket\" object in Bun.serve({})", .{});
            }

            if (this.flags.terminated) {
                return JSValue.jsBoolean(false);
            }

            if (object.as(NodeHTTPResponse)) |nodeHttpResponse| {
                if (nodeHttpResponse.flags.ended or nodeHttpResponse.flags.socket_closed) {
                    return JSC.jsBoolean(false);
                }

                var data_value = JSC.JSValue.zero;

                // if we converted a HeadersInit to a Headers object, we need to free it
                var fetch_headers_to_deref: ?*WebCore.FetchHeaders = null;

                defer {
                    if (fetch_headers_to_deref) |fh| {
                        fh.deref();
                    }
                }

                var sec_websocket_protocol = ZigString.Empty;
                var sec_websocket_extensions = ZigString.Empty;

                if (optional) |opts| {
                    getter: {
                        if (opts.isEmptyOrUndefinedOrNull()) {
                            break :getter;
                        }

                        if (!opts.isObject()) {
                            return globalThis.throwInvalidArguments("upgrade options must be an object", .{});
                        }

                        if (try opts.fastGet(globalThis, .data)) |headers_value| {
                            data_value = headers_value;
                        }

                        if (globalThis.hasException()) {
                            return error.JSError;
                        }

                        if (try opts.fastGet(globalThis, .headers)) |headers_value| {
                            if (headers_value.isEmptyOrUndefinedOrNull()) {
                                break :getter;
                            }

                            var fetch_headers_to_use: *WebCore.FetchHeaders = headers_value.as(WebCore.FetchHeaders) orelse brk: {
                                if (headers_value.isObject()) {
                                    if (WebCore.FetchHeaders.createFromJS(globalThis, headers_value)) |fetch_headers| {
                                        fetch_headers_to_deref = fetch_headers;
                                        break :brk fetch_headers;
                                    }
                                }
                                break :brk null;
                            } orelse {
                                if (!globalThis.hasException()) {
                                    return globalThis.throwInvalidArguments("upgrade options.headers must be a Headers or an object", .{});
                                }
                                return error.JSError;
                            };

                            if (globalThis.hasException()) {
                                return error.JSError;
                            }

                            if (fetch_headers_to_use.fastGet(.SecWebSocketProtocol)) |protocol| {
                                sec_websocket_protocol = protocol;
                            }

                            if (fetch_headers_to_use.fastGet(.SecWebSocketExtensions)) |protocol| {
                                sec_websocket_extensions = protocol;
                            }

                            // we must write the status first so that 200 OK isn't written
                            nodeHttpResponse.raw_response.writeStatus("101 Switching Protocols");
                            fetch_headers_to_use.toUWSResponse(comptime ssl_enabled, nodeHttpResponse.raw_response.socket());
                        }

                        if (globalThis.hasException()) {
                            return error.JSError;
                        }
                    }
                }
                return JSC.jsBoolean(nodeHttpResponse.upgrade(data_value, sec_websocket_protocol, sec_websocket_extensions));
            }

            var request = object.as(Request) orelse {
                return globalThis.throwInvalidArguments("upgrade requires a Request object", .{});
            };

            var upgrader = request.request_context.get(RequestContext) orelse return JSC.jsBoolean(false);

            if (upgrader.isAbortedOrEnded()) {
                return JSC.jsBoolean(false);
            }

            if (upgrader.upgrade_context == null or @intFromPtr(upgrader.upgrade_context) == std.math.maxInt(usize)) {
                return JSC.jsBoolean(false);
            }

            const resp = upgrader.resp.?;
            const ctx = upgrader.upgrade_context.?;

            var sec_websocket_key_str = ZigString.Empty;

            var sec_websocket_protocol = ZigString.Empty;

            var sec_websocket_extensions = ZigString.Empty;

            if (request.getFetchHeaders()) |head| {
                sec_websocket_key_str = head.fastGet(.SecWebSocketKey) orelse ZigString.Empty;
                sec_websocket_protocol = head.fastGet(.SecWebSocketProtocol) orelse ZigString.Empty;
                sec_websocket_extensions = head.fastGet(.SecWebSocketExtensions) orelse ZigString.Empty;
            }

            if (upgrader.req) |req| {
                if (sec_websocket_key_str.len == 0) {
                    sec_websocket_key_str = ZigString.init(req.header("sec-websocket-key") orelse "");
                }
                if (sec_websocket_protocol.len == 0) {
                    sec_websocket_protocol = ZigString.init(req.header("sec-websocket-protocol") orelse "");
                }

                if (sec_websocket_extensions.len == 0) {
                    sec_websocket_extensions = ZigString.init(req.header("sec-websocket-extensions") orelse "");
                }
            }

            if (sec_websocket_key_str.len == 0) {
                return JSC.jsBoolean(false);
            }

            if (sec_websocket_protocol.len > 0) {
                sec_websocket_protocol.markUTF8();
            }

            if (sec_websocket_extensions.len > 0) {
                sec_websocket_extensions.markUTF8();
            }

            var data_value = JSC.JSValue.zero;

            // if we converted a HeadersInit to a Headers object, we need to free it
            var fetch_headers_to_deref: ?*WebCore.FetchHeaders = null;

            defer {
                if (fetch_headers_to_deref) |fh| {
                    fh.deref();
                }
            }

            if (optional) |opts| {
                getter: {
                    if (opts.isEmptyOrUndefinedOrNull()) {
                        break :getter;
                    }

                    if (!opts.isObject()) {
                        return globalThis.throwInvalidArguments("upgrade options must be an object", .{});
                    }

                    if (try opts.fastGet(globalThis, .data)) |headers_value| {
                        data_value = headers_value;
                    }

                    if (globalThis.hasException()) {
                        return error.JSError;
                    }

                    if (try opts.fastGet(globalThis, .headers)) |headers_value| {
                        if (headers_value.isEmptyOrUndefinedOrNull()) {
                            break :getter;
                        }

                        var fetch_headers_to_use: *WebCore.FetchHeaders = headers_value.as(WebCore.FetchHeaders) orelse brk: {
                            if (headers_value.isObject()) {
                                if (WebCore.FetchHeaders.createFromJS(globalThis, headers_value)) |fetch_headers| {
                                    fetch_headers_to_deref = fetch_headers;
                                    break :brk fetch_headers;
                                }
                            }
                            break :brk null;
                        } orelse {
                            if (!globalThis.hasException()) {
                                return globalThis.throwInvalidArguments("upgrade options.headers must be a Headers or an object", .{});
                            }
                            return error.JSError;
                        };

                        if (globalThis.hasException()) {
                            return error.JSError;
                        }

                        if (fetch_headers_to_use.fastGet(.SecWebSocketProtocol)) |protocol| {
                            sec_websocket_protocol = protocol;
                        }

                        if (fetch_headers_to_use.fastGet(.SecWebSocketExtensions)) |protocol| {
                            sec_websocket_extensions = protocol;
                        }

                        // we must write the status first so that 200 OK isn't written
                        resp.writeStatus("101 Switching Protocols");
                        fetch_headers_to_use.toUWSResponse(comptime ssl_enabled, resp);
                    }

                    if (globalThis.hasException()) {
                        return error.JSError;
                    }
                }
            }

            // --- After this point, do not throw an exception
            // See https://github.com/oven-sh/bun/issues/1339

            // obviously invalid pointer marks it as used
            upgrader.upgrade_context = @as(*uws.SocketContext, @ptrFromInt(std.math.maxInt(usize)));
            const signal = upgrader.signal;

            upgrader.signal = null;
            upgrader.resp = null;
            request.request_context = AnyRequestContext.Null;
            upgrader.request_weakref.deref();

            data_value.ensureStillAlive();
            const ws = ServerWebSocket.new(.{
                .handler = &this.config.websocket.?.handler,
                .this_value = data_value,
                .signal = signal,
            });
            data_value.ensureStillAlive();

            var sec_websocket_protocol_str = sec_websocket_protocol.toSlice(bun.default_allocator);
            defer sec_websocket_protocol_str.deinit();
            var sec_websocket_extensions_str = sec_websocket_extensions.toSlice(bun.default_allocator);
            defer sec_websocket_extensions_str.deinit();

            resp.clearAborted();
            resp.clearOnData();
            resp.clearOnWritable();
            resp.clearTimeout();

            upgrader.deref();

            _ = resp.upgrade(
                *ServerWebSocket,
                ws,
                sec_websocket_key_str.slice(),
                sec_websocket_protocol_str.slice(),
                sec_websocket_extensions_str.slice(),
                ctx,
            );

            return JSC.jsBoolean(true);
        }

        pub fn onReloadFromZig(this: *ThisServer, new_config: *ServerConfig, globalThis: *JSC.JSGlobalObject) void {
            httplog("onReload", .{});

            this.app.?.clearRoutes();

            // only reload those two, but ignore if they're not specified.
            if (this.config.onRequest != new_config.onRequest and (new_config.onRequest != .zero and !new_config.onRequest.isUndefined())) {
                this.config.onRequest.unprotect();
                this.config.onRequest = new_config.onRequest;
            }
            if (this.config.onNodeHTTPRequest != new_config.onNodeHTTPRequest) {
                this.config.onNodeHTTPRequest.unprotect();
                this.config.onNodeHTTPRequest = new_config.onNodeHTTPRequest;
            }
            if (this.config.onError != new_config.onError and (new_config.onError != .zero and !new_config.onError.isUndefined())) {
                this.config.onError.unprotect();
                this.config.onError = new_config.onError;
            }

            if (new_config.websocket) |*ws| {
                ws.handler.flags.ssl = ssl_enabled;
                if (ws.handler.onMessage != .zero or ws.handler.onOpen != .zero) {
                    if (this.config.websocket) |old_ws| {
                        old_ws.unprotect();
                    }

                    ws.globalObject = globalThis;
                    this.config.websocket = ws.*;
                } // we don't remove it
            }

            // These get re-applied when we set the static routes again.
            if (this.dev_server) |dev_server| {
                // Prevent a use-after-free in the hash table keys.
                dev_server.html_router.clear();
                dev_server.html_router.fallback = null;
            }

            var static_routes = this.config.static_routes;
            this.config.static_routes = .init(bun.default_allocator);
            for (static_routes.items) |*route| {
                route.deinit();
            }
            static_routes.deinit();
            this.config.static_routes = new_config.static_routes;

            for (this.config.negative_routes.items) |route| {
                bun.default_allocator.free(route);
            }
            this.config.negative_routes.clearAndFree();
            this.config.negative_routes = new_config.negative_routes;

            if (new_config.had_routes_object) {
                for (this.config.user_routes_to_build.items) |*route| {
                    route.deinit();
                }
                this.config.user_routes_to_build.clearAndFree();
                this.config.user_routes_to_build = new_config.user_routes_to_build;
                for (this.user_routes.items) |*route| {
                    route.deinit();
                }
                this.user_routes.clearAndFree(bun.default_allocator);
            }

            const route_list_value = this.setRoutes();
            if (new_config.had_routes_object) {
                if (this.js_value.get()) |server_js_value| {
                    js.routeListSetCached(server_js_value, this.globalThis, route_list_value);
                }
            }

            if (this.inspector_server_id.toOptional().unwrap() != null) {
                if (this.vm.debugger) |*debugger| {
                    debugger.http_server_agent.notifyServerRoutesUpdated(
                        AnyServer.from(this),
                    ) catch bun.outOfMemory();
                }
            }
        }

        pub fn reloadStaticRoutes(this: *ThisServer) !bool {
            if (this.app == null) {
                // Static routes will get cleaned up when the server is stopped
                return false;
            }
            this.config = try this.config.cloneForReloadingStaticRoutes();
            this.app.?.clearRoutes();
            const route_list_value = this.setRoutes();
            if (route_list_value != .zero) {
                if (this.js_value.get()) |server_js_value| {
                    js.routeListSetCached(server_js_value, this.globalThis, route_list_value);
                }
            }
            return true;
        }

        pub fn onReload(this: *ThisServer, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments = callframe.arguments();
            if (arguments.len < 1) {
                return globalThis.throwNotEnoughArguments("reload", 1, 0);
            }

            var args_slice = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
            defer args_slice.deinit();

            var new_config: ServerConfig = .{};
            try ServerConfig.fromJS(globalThis, &new_config, &args_slice, .{
                .allow_bake_config = false,
                .is_fetch_required = true,
                .has_user_routes = this.user_routes.items.len > 0,
            });
            if (globalThis.hasException()) {
                new_config.deinit();
                return error.JSError;
            }

            this.onReloadFromZig(&new_config, globalThis);

            return this.js_value.get() orelse .js_undefined;
        }

        pub fn onFetch(
            this: *ThisServer,
            ctx: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());

            if (this.config.onRequest == .zero) {
                return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, ZigString.init("fetch() requires the server to have a fetch handler").toErrorInstance(ctx));
            }

            const arguments = callframe.arguments_old(2).slice();
            if (arguments.len == 0) {
                const fetch_error = WebCore.Fetch.fetch_error_no_args;
                return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, ZigString.init(fetch_error).toErrorInstance(ctx));
            }

            var headers: ?*WebCore.FetchHeaders = null;
            var method = HTTP.Method.GET;
            var args = JSC.CallFrame.ArgumentsSlice.init(ctx.bunVM(), arguments);
            defer args.deinit();

            var first_arg = args.nextEat().?;
            var body: JSC.WebCore.Body.Value = .{ .Null = {} };
            var existing_request: WebCore.Request = undefined;
            // TODO: set Host header
            // TODO: set User-Agent header
            // TODO: unify with fetch() implementation.
            if (first_arg.isString()) {
                const url_zig_str = try arguments[0].toSlice(ctx, bun.default_allocator);
                defer url_zig_str.deinit();
                var temp_url_str = url_zig_str.slice();

                if (temp_url_str.len == 0) {
                    const fetch_error = JSC.WebCore.Fetch.fetch_error_blank_url;
                    return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, ZigString.init(fetch_error).toErrorInstance(ctx));
                }

                var url = URL.parse(temp_url_str);

                if (url.hostname.len == 0) {
                    url = URL.parse(
                        strings.append(this.allocator, this.base_url_string_for_joining, url.pathname) catch unreachable,
                    );
                } else {
                    temp_url_str = this.allocator.dupe(u8, temp_url_str) catch unreachable;
                    url = URL.parse(temp_url_str);
                }

                if (arguments.len >= 2 and arguments[1].isObject()) {
                    var opts = arguments[1];
                    if (try opts.fastGet(ctx, .method)) |method_| {
                        var slice_ = try method_.toSlice(ctx, bun.default_allocator);
                        defer slice_.deinit();
                        method = HTTP.Method.which(slice_.slice()) orelse method;
                    }

                    if (try opts.fastGet(ctx, .headers)) |headers_| {
                        if (headers_.as(WebCore.FetchHeaders)) |headers__| {
                            headers = headers__;
                        } else if (WebCore.FetchHeaders.createFromJS(ctx, headers_)) |headers__| {
                            headers = headers__;
                        }
                    }

                    if (try opts.fastGet(ctx, .body)) |body__| {
                        if (Blob.get(ctx, body__, true, false)) |new_blob| {
                            body = .{ .Blob = new_blob };
                        } else |_| {
                            return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, ZigString.init("fetch() received invalid body").toErrorInstance(ctx));
                        }
                    }
                }

                existing_request = Request.init(
                    bun.String.createUTF8(url.href),
                    headers,
                    this.vm.initRequestBodyValue(body) catch bun.outOfMemory(),
                    method,
                );
            } else if (first_arg.as(Request)) |request_| {
                request_.cloneInto(
                    &existing_request,
                    bun.default_allocator,
                    ctx,
                    false,
                );
            } else {
                const fetch_error = JSC.WebCore.Fetch.fetch_type_error_strings.get(bun.JSC.C.JSValueGetType(ctx, first_arg.asRef()));
                const err = ctx.toTypeError(.INVALID_ARG_TYPE, "{s}", .{fetch_error});

                return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, err);
            }

            var request = Request.new(existing_request);

            bun.assert(this.config.onRequest != .zero); // confirmed above
            const response_value = this.config.onRequest.call(
                this.globalThis,
                this.jsValueAssertAlive(),
                &[_]JSC.JSValue{request.toJS(this.globalThis)},
            ) catch |err| this.globalThis.takeException(err);

            if (response_value.isAnyError()) {
                return JSC.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, response_value);
            }

            if (response_value.isEmptyOrUndefinedOrNull()) {
                return JSC.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(ctx, ZigString.init("fetch() returned an empty value").toErrorInstance(ctx));
            }

            if (response_value.asAnyPromise() != null) {
                return response_value;
            }

            if (response_value.as(JSC.WebCore.Response)) |resp| {
                resp.url = existing_request.url.clone();
            }
            return JSC.JSPromise.resolvedPromiseValue(ctx, response_value);
        }

        pub fn stopFromJS(this: *ThisServer, abruptly: ?JSValue) JSC.JSValue {
            const rc = this.getAllClosedPromise(this.globalThis);

            if (this.listener != null) {
                const abrupt = brk: {
                    if (abruptly) |val| {
                        if (val.isBoolean() and val.toBoolean()) {
                            break :brk true;
                        }
                    }
                    break :brk false;
                };

                this.stop(abrupt);
            }

            return rc;
        }

        pub fn disposeFromJS(this: *ThisServer) JSC.JSValue {
            if (this.listener != null) {
                this.stop(true);
            }

            return .js_undefined;
        }

        pub fn getPort(
            this: *ThisServer,
            _: *JSC.JSGlobalObject,
        ) JSC.JSValue {
            switch (this.config.address) {
                .unix => return .js_undefined,
                else => {},
            }

            var listener = this.listener orelse return JSC.JSValue.jsNumber(this.config.address.tcp.port);
            return JSC.JSValue.jsNumber(listener.getLocalPort());
        }

        pub fn getId(
            this: *ThisServer,
            globalThis: *JSC.JSGlobalObject,
        ) JSC.JSValue {
            return bun.String.createUTF8ForJS(globalThis, this.config.id);
        }

        pub fn getPendingRequests(
            this: *ThisServer,
            _: *JSC.JSGlobalObject,
        ) JSC.JSValue {
            return JSC.JSValue.jsNumber(@as(i32, @intCast(@as(u31, @truncate(this.pending_requests)))));
        }

        pub fn getPendingWebSockets(
            this: *ThisServer,
            _: *JSC.JSGlobalObject,
        ) JSC.JSValue {
            return JSC.JSValue.jsNumber(@as(i32, @intCast(@as(u31, @truncate(this.activeSocketsCount())))));
        }

        pub fn getAddress(this: *ThisServer, globalThis: *JSGlobalObject) JSC.JSValue {
            switch (this.config.address) {
                .unix => |unix| {
                    var value = bun.String.createUTF8(unix);
                    defer value.deref();
                    return value.toJS(globalThis);
                },
                .tcp => {
                    var port: u16 = this.config.address.tcp.port;

                    if (this.listener) |listener| {
                        port = @intCast(listener.getLocalPort());

                        var buf: [64]u8 = [_]u8{0} ** 64;
                        const address_bytes = listener.socket().localAddress(&buf) orelse return JSValue.jsNull();
                        var addr = SocketAddress.init(address_bytes, port) catch {
                            @branchHint(.unlikely);
                            return JSValue.jsNull();
                        };
                        return addr.intoDTO(this.globalThis);
                    }
                    return JSValue.jsNull();
                },
            }
        }

        pub fn getURLAsString(this: *const ThisServer) bun.OOM!bun.String {
            const fmt = switch (this.config.address) {
                .unix => |unix| brk: {
                    if (unix.len > 1 and unix[0] == 0) {
                        // abstract domain socket, let's give it an "abstract" URL
                        break :brk bun.fmt.URLFormatter{
                            .proto = .abstract,
                            .hostname = unix[1..],
                        };
                    }

                    break :brk bun.fmt.URLFormatter{
                        .proto = .unix,
                        .hostname = unix,
                    };
                },
                .tcp => |tcp| blk: {
                    var port: u16 = tcp.port;
                    if (this.listener) |listener| {
                        port = @intCast(listener.getLocalPort());
                    }
                    break :blk bun.fmt.URLFormatter{
                        .proto = if (comptime ssl_enabled) .https else .http,
                        .hostname = if (tcp.hostname) |hostname| bun.sliceTo(@constCast(hostname), 0) else null,
                        .port = port,
                    };
                },
            };

            const buf = try std.fmt.allocPrint(default_allocator, "{any}", .{fmt});
            defer default_allocator.free(buf);

            return bun.String.createUTF8(buf);
        }

        pub fn getURL(this: *ThisServer, globalThis: *JSGlobalObject) bun.OOM!JSC.JSValue {
            var url = try this.getURLAsString();
            defer url.deref();

            return url.toJSDOMURL(globalThis);
        }

        pub fn getHostname(this: *ThisServer, globalThis: *JSGlobalObject) JSC.JSValue {
            switch (this.config.address) {
                .unix => return .js_undefined,
                else => {},
            }

            if (this.cached_hostname.isEmpty()) {
                if (this.listener) |listener| {
                    var buf: [1024]u8 = [_]u8{0} ** 1024;

                    if (listener.socket().remoteAddress(buf[0..1024])) |addr| {
                        if (addr.len > 0) {
                            this.cached_hostname = bun.String.createUTF8(addr);
                        }
                    }
                }

                if (this.cached_hostname.isEmpty()) {
                    switch (this.config.address) {
                        .tcp => |tcp| {
                            if (tcp.hostname) |hostname| {
                                this.cached_hostname = bun.String.createUTF8(bun.sliceTo(hostname, 0));
                            } else {
                                this.cached_hostname = bun.String.createAtomASCII("localhost");
                            }
                        },
                        else => {},
                    }
                }
            }

            return this.cached_hostname.toJS(globalThis);
        }

        pub fn getProtocol(this: *ThisServer, globalThis: *JSGlobalObject) JSC.JSValue {
            _ = this;
            return bun.String.static(if (ssl_enabled) "https" else "http").toJS(globalThis);
        }

        pub fn getDevelopment(
            _: *ThisServer,
            _: *JSC.JSGlobalObject,
        ) JSC.JSValue {
            return JSC.JSValue.jsBoolean(debug_mode);
        }

        pub fn onStaticRequestComplete(this: *ThisServer) void {
            this.pending_requests -= 1;
            this.deinitIfWeCan();
        }

        pub fn onRequestComplete(this: *ThisServer) void {
            this.vm.eventLoop().processGCTimer();

            this.pending_requests -= 1;
            this.deinitIfWeCan();
        }

        pub fn finalize(this: *ThisServer) void {
            httplog("finalize", .{});
            this.flags.has_js_deinited = true;
            this.deinitIfWeCan();
        }

        pub fn activeSocketsCount(this: *const ThisServer) u32 {
            const websocket = &(this.config.websocket orelse return 0);
            return @as(u32, @truncate(websocket.handler.active_connections));
        }

        pub fn hasActiveWebSockets(this: *const ThisServer) bool {
            return this.activeSocketsCount() > 0;
        }

        pub fn getAllClosedPromise(this: *ThisServer, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
            if (this.listener == null and this.pending_requests == 0) {
                return JSC.JSPromise.resolvedPromise(globalThis, .js_undefined).toJS();
            }
            const prom = &this.all_closed_promise;
            if (prom.strong.has()) {
                return prom.value();
            }
            prom.* = JSC.JSPromise.Strong.init(globalThis);
            return prom.value();
        }

        pub fn deinitIfWeCan(this: *ThisServer) void {
            if (Environment.enable_logs)
                httplog("deinitIfWeCan. requests={d}, listener={s}, websockets={s}, has_handled_all_closed_promise={}, all_closed_promise={s}, has_js_deinited={}", .{
                    this.pending_requests,
                    if (this.listener == null) "null" else "some",
                    if (this.hasActiveWebSockets()) "active" else "no",
                    this.flags.has_handled_all_closed_promise,
                    if (this.all_closed_promise.strong.has()) "has" else "no",
                    this.flags.has_js_deinited,
                });

            const vm = this.globalThis.bunVM();

            if (this.pending_requests == 0 and
                this.listener == null and
                !this.hasActiveWebSockets() and
                !this.flags.has_handled_all_closed_promise and
                this.all_closed_promise.strong.has())
            {
                httplog("schedule other promise", .{});
                const event_loop = vm.eventLoop();

                // use a flag here instead of `this.all_closed_promise.get().isHandled(vm)` to prevent the race condition of this block being called
                // again before the task has run.
                this.flags.has_handled_all_closed_promise = true;

                const task = ServerAllConnectionsClosedTask.new(.{
                    .globalObject = this.globalThis,
                    // Duplicate the Strong handle so that we can hold two independent strong references to it.
                    .promise = .{
                        .strong = .create(this.all_closed_promise.value(), this.globalThis),
                    },
                    .tracker = JSC.Debugger.AsyncTaskTracker.init(vm),
                });
                event_loop.enqueueTask(JSC.Task.init(task));
            }
            if (this.pending_requests == 0 and
                this.listener == null and
                !this.hasActiveWebSockets())
            {
                if (this.config.websocket) |*ws| {
                    ws.handler.app = null;
                }
                this.unref();

                // Detach DevServer. This is needed because there are aggressive
                // tests that check for DevServer memory soundness. This reveals
                // a larger problem, that it seems that some objects like Server
                // should be detachable from their JSValue, so that when the
                // native handle is done, keeping the JS binding doesn't use
                // `this.memoryCost()` bytes.
                if (this.dev_server) |dev| {
                    this.dev_server = null;
                    if (this.app) |app| app.clearRoutes();
                    dev.deinit();
                }

                // Only free the memory if the JS reference has been freed too
                if (this.flags.has_js_deinited) {
                    this.scheduleDeinit();
                }
            }
        }

        pub fn stopListening(this: *ThisServer, abrupt: bool) void {
            httplog("stopListening", .{});
            var listener = this.listener orelse return;
            this.listener = null;
            this.unref();

            if (!ssl_enabled)
                this.vm.removeListeningSocketForWatchMode(listener.socket().fd());

            this.notifyInspectorServerStopped();

            if (!abrupt) {
                listener.close();
            } else if (!this.flags.terminated) {
                if (this.config.websocket) |*ws| {
                    ws.handler.app = null;
                }
                this.flags.terminated = true;
                this.app.?.close();
            }
        }

        pub fn stop(this: *ThisServer, abrupt: bool) void {
            this.js_value.deinit();

            if (this.config.allow_hot and this.config.id.len > 0) {
                if (this.globalThis.bunVM().hotMap()) |hot| {
                    hot.remove(this.config.id);
                }
            }

            this.stopListening(abrupt);
            this.deinitIfWeCan();
        }

        pub fn scheduleDeinit(this: *ThisServer) void {
            if (this.flags.deinit_scheduled) {
                httplog("scheduleDeinit (again)", .{});
                return;
            }
            this.flags.deinit_scheduled = true;
            httplog("scheduleDeinit", .{});

            if (!this.flags.terminated) {
                // App.close can cause finalizers to run.
                // scheduleDeinit can be called inside a finalizer.
                // Therefore, we split it into two tasks.
                this.flags.terminated = true;
                const task = bun.default_allocator.create(JSC.AnyTask) catch unreachable;
                task.* = JSC.AnyTask.New(App, App.close).init(this.app.?);
                this.vm.enqueueTask(JSC.Task.init(task));
            }

            const task = bun.default_allocator.create(JSC.AnyTask) catch unreachable;
            task.* = JSC.AnyTask.New(ThisServer, deinit).init(this);
            this.vm.enqueueTask(JSC.Task.init(task));
        }

        fn notifyInspectorServerStopped(this: *ThisServer) void {
            if (this.inspector_server_id.toOptional().unwrap() != null) {
                @branchHint(.unlikely);
                if (this.vm.debugger) |*debugger| {
                    @branchHint(.unlikely);
                    debugger.http_server_agent.notifyServerStopped(
                        AnyServer.from(this),
                    );
                    this.inspector_server_id = .init(0);
                }
            }
        }

        pub fn deinit(this: *ThisServer) void {
            httplog("deinit", .{});

            // This should've already been handled in stopListening
            // However, when the JS VM terminates, it hypothetically might not call stopListening
            this.notifyInspectorServerStopped();

            this.cached_hostname.deref();
            this.all_closed_promise.deinit();
            for (this.user_routes.items) |*user_route| {
                user_route.deinit();
            }
            this.user_routes.deinit(bun.default_allocator);

            this.config.deinit();

            this.on_clienterror.deinit();
            if (this.app) |app| {
                this.app = null;
                app.destroy();
            }

            if (this.dev_server) |dev_server| {
                dev_server.deinit();
            }

            if (this.plugins) |plugins| {
                plugins.deref();
            }

            bun.destroy(this);
        }

        pub fn init(config: *ServerConfig, global: *JSGlobalObject) bun.JSOOM!*ThisServer {
            const base_url = try bun.default_allocator.dupe(u8, strings.trim(config.base_url.href, "/"));
            errdefer bun.default_allocator.free(base_url);

            const dev_server = if (config.bake) |*bake_options|
                try bun.bake.DevServer.init(.{
                    .arena = bake_options.arena.allocator(),
                    .root = bake_options.root,
                    .framework = bake_options.framework,
                    .bundler_options = bake_options.bundler_options,
                    .vm = global.bunVM(),
                    .broadcast_console_log_from_browser_to_server = config.broadcast_console_log_from_browser_to_server_for_bake,
                })
            else
                null;
            errdefer if (dev_server) |d| d.deinit();

            var server = ThisServer.new(.{
                .globalThis = global,
                .config = config.*,
                .base_url_string_for_joining = base_url,
                .vm = JSC.VirtualMachine.get(),
                .allocator = Arena.getThreadlocalDefault(),
                .dev_server = dev_server,
            });

            if (RequestContext.pool == null) {
                RequestContext.pool = bun.create(
                    server.allocator,
                    RequestContext.RequestContextStackAllocator,
                    RequestContext.RequestContextStackAllocator.init(bun.typedAllocator(RequestContext)),
                );
            }

            server.request_pool_allocator = RequestContext.pool.?;

            if (comptime ssl_enabled) {
                Analytics.Features.https_server += 1;
            } else {
                Analytics.Features.http_server += 1;
            }

            return server;
        }

        noinline fn onListenFailed(this: *ThisServer) void {
            httplog("onListenFailed", .{});

            const globalThis = this.globalThis;

            var error_instance = JSC.JSValue.zero;
            var output_buf: [4096]u8 = undefined;

            if (comptime ssl_enabled) {
                output_buf[0] = 0;
                var written: usize = 0;
                var ssl_error = BoringSSL.ERR_get_error();
                while (ssl_error != 0 and written < output_buf.len) : (ssl_error = BoringSSL.ERR_get_error()) {
                    if (written > 0) {
                        output_buf[written] = '\n';
                        written += 1;
                    }

                    if (BoringSSL.ERR_reason_error_string(
                        ssl_error,
                    )) |reason_ptr| {
                        const reason = std.mem.span(reason_ptr);
                        if (reason.len == 0) {
                            break;
                        }
                        @memcpy(output_buf[written..][0..reason.len], reason);
                        written += reason.len;
                    }

                    if (BoringSSL.ERR_func_error_string(
                        ssl_error,
                    )) |reason_ptr| {
                        const reason = std.mem.span(reason_ptr);
                        if (reason.len > 0) {
                            output_buf[written..][0.." via ".len].* = " via ".*;
                            written += " via ".len;
                            @memcpy(output_buf[written..][0..reason.len], reason);
                            written += reason.len;
                        }
                    }

                    if (BoringSSL.ERR_lib_error_string(
                        ssl_error,
                    )) |reason_ptr| {
                        const reason = std.mem.span(reason_ptr);
                        if (reason.len > 0) {
                            output_buf[written..][0] = ' ';
                            written += 1;
                            @memcpy(output_buf[written..][0..reason.len], reason);
                            written += reason.len;
                        }
                    }
                }

                if (written > 0) {
                    const message = output_buf[0..written];
                    error_instance = globalThis.createErrorInstance("OpenSSL {s}", .{message});
                    BoringSSL.ERR_clear_error();
                }
            }

            if (error_instance == .zero) {
                switch (this.config.address) {
                    .tcp => |tcp| {
                        error_set: {
                            if (comptime Environment.isLinux) {
                                const rc: i32 = -1;
                                const code = Sys.getErrno(rc);
                                if (code == bun.sys.E.ACCES) {
                                    error_instance = (JSC.SystemError{
                                        .message = bun.String.init(std.fmt.bufPrint(&output_buf, "permission denied {s}:{d}", .{ tcp.hostname orelse "0.0.0.0", tcp.port }) catch "Failed to start server"),
                                        .code = bun.String.static("EACCES"),
                                        .syscall = bun.String.static("listen"),
                                    }).toErrorInstance(globalThis);
                                    break :error_set;
                                }
                            }
                            error_instance = (JSC.SystemError{
                                .message = bun.String.init(std.fmt.bufPrint(&output_buf, "Failed to start server. Is port {d} in use?", .{tcp.port}) catch "Failed to start server"),
                                .code = bun.String.static("EADDRINUSE"),
                                .syscall = bun.String.static("listen"),
                            }).toErrorInstance(globalThis);
                        }
                    },
                    .unix => |unix| {
                        switch (bun.sys.getErrno(@as(i32, -1))) {
                            .SUCCESS => {
                                error_instance = (JSC.SystemError{
                                    .message = bun.String.init(std.fmt.bufPrint(&output_buf, "Failed to listen on unix socket {}", .{bun.fmt.QuotedFormatter{ .text = unix }}) catch "Failed to start server"),
                                    .code = bun.String.static("EADDRINUSE"),
                                    .syscall = bun.String.static("listen"),
                                }).toErrorInstance(globalThis);
                            },
                            else => |e| {
                                var sys_err = bun.sys.Error.fromCode(e, .listen);
                                sys_err.path = unix;
                                error_instance = sys_err.toJSC(globalThis);
                            },
                        }
                    },
                }
            }

            error_instance.ensureStillAlive();
            globalThis.throwValue(error_instance) catch {};
        }

        pub fn onListen(this: *ThisServer, socket: ?*App.ListenSocket) void {
            if (socket == null) {
                return this.onListenFailed();
            }

            this.listener = socket;
            this.vm.event_loop_handle = Async.Loop.get();
            if (!ssl_enabled)
                this.vm.addListeningSocketForWatchMode(socket.?.socket().fd());
        }

        pub fn ref(this: *ThisServer) void {
            if (this.poll_ref.isActive()) return;

            this.poll_ref.ref(this.vm);
        }

        pub fn unref(this: *ThisServer) void {
            if (!this.poll_ref.isActive()) return;

            this.poll_ref.unref(this.vm);
        }

        pub fn doRef(this: *ThisServer, _: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const this_value = callframe.this();
            this.ref();

            return this_value;
        }

        pub fn doUnref(this: *ThisServer, _: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const this_value = callframe.this();
            this.unref();

            return this_value;
        }

        pub fn onBunInfoRequest(this: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            JSC.markBinding(@src());
            this.pending_requests += 1;
            defer this.pending_requests -= 1;
            req.setYield(false);
            var stack_fallback = std.heap.stackFallback(8192, this.allocator);
            const allocator = stack_fallback.get();

            const buffer_writer = js_printer.BufferWriter.init(allocator);
            var writer = js_printer.BufferPrinter.init(buffer_writer);
            defer writer.ctx.buffer.deinit();
            const source = &logger.Source.initEmptyFile("info.json");
            _ = js_printer.printJSON(
                *js_printer.BufferPrinter,
                &writer,
                bun.Global.BunInfo.generate(*Transpiler, &JSC.VirtualMachine.get().transpiler, allocator) catch unreachable,
                source,
                .{ .mangled_props = null },
            ) catch unreachable;

            resp.writeStatus("200 OK");
            resp.writeHeader("Content-Type", MimeType.json.value);
            resp.writeHeader("Cache-Control", "public, max-age=3600");
            resp.writeHeaderInt("Age", 0);
            const buffer = writer.ctx.written;
            resp.end(buffer, false);
        }

        pub fn onPendingRequest(this: *ThisServer) void {
            this.pending_requests += 1;
        }

        pub fn onNodeHTTPRequestWithUpgradeCtx(this: *ThisServer, req: *uws.Request, resp: *App.Response, upgrade_ctx: ?*uws.SocketContext) void {
            this.onPendingRequest();
            if (comptime Environment.isDebug) {
                this.vm.eventLoop().debug.enter();
            }
            defer {
                if (comptime Environment.isDebug) {
                    this.vm.eventLoop().debug.exit();
                }
            }
            req.setYield(false);
            resp.timeout(this.config.idleTimeout);

            const globalThis = this.globalThis;
            const thisObject: JSValue = this.js_value.get() orelse .js_undefined;
            const vm = this.vm;

            var node_http_response: ?*NodeHTTPResponse = null;
            var is_async = false;
            defer {
                if (!is_async) {
                    if (node_http_response) |node_response| {
                        node_response.deref();
                    }
                }
            }

            const result: JSValue = onNodeHTTPRequestFn(
                @intFromPtr(AnyServer.from(this).ptr.ptr()),
                globalThis,
                thisObject,
                this.config.onNodeHTTPRequest,
                if (bun.http.Method.find(req.method())) |method|
                    method.toJS(globalThis)
                else
                    .js_undefined,
                req,
                resp,
                upgrade_ctx,
                &node_http_response,
            );

            const HTTPResult = union(enum) {
                rejection: JSC.JSValue,
                exception: JSC.JSValue,
                success: void,
                pending: JSC.JSValue,
            };
            var strong_promise: JSC.Strong.Optional = .empty;
            var needs_to_drain = true;

            defer {
                if (needs_to_drain) {
                    vm.drainMicrotasks();
                }
            }
            defer strong_promise.deinit();
            const http_result: HTTPResult = brk: {
                if (result.toError()) |err| {
                    break :brk .{ .exception = err };
                }

                if (result.asAnyPromise()) |promise| {
                    if (promise.status(globalThis.vm()) == .pending) {
                        strong_promise.set(globalThis, result);
                        needs_to_drain = false;
                        vm.drainMicrotasks();
                    }

                    switch (promise.status(globalThis.vm())) {
                        .fulfilled => {
                            globalThis.handleRejectedPromises();
                            break :brk .{ .success = {} };
                        },
                        .rejected => {
                            promise.setHandled(globalThis.vm());
                            break :brk .{ .rejection = promise.result(globalThis.vm()) };
                        },
                        .pending => {
                            globalThis.handleRejectedPromises();
                            if (node_http_response) |node_response| {
                                if (node_response.flags.request_has_completed or node_response.flags.socket_closed or node_response.flags.upgraded) {
                                    strong_promise.deinit();
                                    break :brk .{ .success = {} };
                                }

                                const strong_self = node_response.getThisValue();

                                if (strong_self.isEmptyOrUndefinedOrNull()) {
                                    strong_promise.deinit();
                                    break :brk .{ .success = {} };
                                }

                                node_response.promise = strong_promise;
                                strong_promise = .empty;
                                result._then2(globalThis, strong_self, NodeHTTPResponse.Bun__NodeHTTPRequest__onResolve, NodeHTTPResponse.Bun__NodeHTTPRequest__onReject);
                                is_async = true;
                            }

                            break :brk .{ .pending = result };
                        },
                    }
                }

                break :brk .{ .success = {} };
            };

            switch (http_result) {
                .exception, .rejection => |err| {
                    _ = vm.uncaughtException(globalThis, err, http_result == .rejection);

                    if (node_http_response) |node_response| {
                        if (!node_response.flags.request_has_completed and node_response.raw_response.state().isResponsePending()) {
                            if (node_response.raw_response.state().isHttpStatusCalled()) {
                                node_response.raw_response.writeStatus("500 Internal Server Error");
                                node_response.raw_response.endWithoutBody(true);
                            } else {
                                node_response.raw_response.endStream(true);
                            }
                        }
                        node_response.onRequestComplete();
                    }
                },
                .success => {},
                .pending => {},
            }

            if (node_http_response) |node_response| {
                if (!node_response.flags.upgraded) {
                    if (!node_response.flags.request_has_completed and node_response.raw_response.state().isResponsePending()) {
                        node_response.setOnAbortedHandler();
                    }
                    // If we ended the response without attaching an ondata handler, we discard the body read stream
                    else if (http_result != .pending) {
                        node_response.maybeStopReadingBody(vm, node_response.getThisValue());
                    }
                }
            }
        }

        pub fn onNodeHTTPRequest(
            this: *ThisServer,
            req: *uws.Request,
            resp: *App.Response,
        ) void {
            JSC.markBinding(@src());
            onNodeHTTPRequestWithUpgradeCtx(this, req, resp, null);
        }

        const onNodeHTTPRequestFn = if (ssl_enabled)
            NodeHTTPServer__onRequest_https
        else
            NodeHTTPServer__onRequest_http;

        pub fn setUsingCustomExpectHandler(this: *ThisServer, value: bool) void {
            NodeHTTP_setUsingCustomExpectHandler(ssl_enabled, this.app.?, value);
        }

        var did_send_idletimeout_warning_once = false;
        fn onTimeoutForIdleWarn(_: *anyopaque, _: *App.Response) void {
            if (debug_mode and !did_send_idletimeout_warning_once) {
                if (!bun.CLI.Command.get().debug.silent) {
                    did_send_idletimeout_warning_once = true;
                    Output.prettyErrorln("<r><yellow>[Bun.serve]<r><d>:<r> request timed out after 10 seconds. Pass <d><cyan>`idleTimeout`<r> to configure.", .{});
                    Output.flush();
                }
            }
        }

        fn shouldAddTimeoutHandlerForWarning(server: *ThisServer) bool {
            if (comptime debug_mode) {
                if (!did_send_idletimeout_warning_once and !bun.CLI.Command.get().debug.silent) {
                    return !server.config.has_idleTimeout;
                }
            }

            return false;
        }

        pub fn onUserRouteRequest(user_route: *UserRoute, req: *uws.Request, resp: *App.Response) void {
            const server = user_route.server;
            const index = user_route.id;

            var should_deinit_context = false;
            var prepared = server.prepareJsRequestContext(req, resp, &should_deinit_context, false, switch (user_route.route.method) {
                .any => null,
                .specific => |m| m,
            }) orelse return;

            const server_request_list = js.routeListGetCached(server.jsValueAssertAlive()).?;
            var response_value = Bun__ServerRouteList__callRoute(server.globalThis, index, prepared.request_object, server.jsValueAssertAlive(), server_request_list, &prepared.js_request, req);

            if (server.globalThis.tryTakeException()) |exception| {
                response_value = exception;
            }

            server.handleRequest(&should_deinit_context, prepared, req, response_value);
        }

        fn handleRequest(this: *ThisServer, should_deinit_context: *bool, prepared: PreparedRequest, req: *uws.Request, response_value: JSC.JSValue) void {
            const ctx = prepared.ctx;

            defer {
                // uWS request will not live longer than this function
                prepared.request_object.request_context.detachRequest();
            }

            ctx.onResponse(this, prepared.js_request, response_value);
            // Reference in the stack here in case it is not for whatever reason
            prepared.js_request.ensureStillAlive();

            ctx.defer_deinit_until_callback_completes = null;

            if (should_deinit_context.*) {
                ctx.deinit();
                return;
            }

            if (ctx.shouldRenderMissing()) {
                ctx.renderMissing();
                return;
            }

            // The request is asynchronous, and all information from `req` must be copied
            // since the provided uws.Request will be re-used for future requests (stack allocated).
            ctx.toAsync(req, prepared.request_object);
        }

        pub fn onRequest(
            this: *ThisServer,
            req: *uws.Request,
            resp: *App.Response,
        ) void {
            var should_deinit_context = false;
            const prepared = this.prepareJsRequestContext(req, resp, &should_deinit_context, true, null) orelse return;

            bun.assert(this.config.onRequest != .zero);

            const js_value = this.jsValueAssertAlive();
            const response_value = this.config.onRequest.call(
                this.globalThis,
                js_value,
                &.{ prepared.js_request, js_value },
            ) catch |err|
                this.globalThis.takeException(err);

            this.handleRequest(&should_deinit_context, prepared, req, response_value);
        }

        pub fn onRequestFromSaved(
            this: *ThisServer,
            req: SavedRequest.Union,
            resp: *App.Response,
            callback: JSValue,
            comptime arg_count: comptime_int,
            extra_args: [arg_count]JSValue,
        ) void {
            const prepared: PreparedRequest = switch (req) {
                .stack => |r| this.prepareJsRequestContext(r, resp, null, true, null) orelse return,
                .saved => |data| .{
                    .js_request = data.js_request.get() orelse @panic("Request was unexpectedly freed"),
                    .request_object = data.request,
                    .ctx = data.ctx.tagged_pointer.as(RequestContext),
                },
            };
            const ctx = prepared.ctx;

            bun.assert(callback != .zero);
            const args = .{prepared.js_request} ++ extra_args;
            const response_value = callback.call(
                this.globalThis,
                this.jsValueAssertAlive(),
                &args,
            ) catch |err|
                this.globalThis.takeException(err);

            defer if (req == .stack) {
                // uWS request will not live longer than this function
                prepared.request_object.request_context.detachRequest();
            };
            const original_state = ctx.defer_deinit_until_callback_completes;
            var should_deinit_context = false;
            ctx.defer_deinit_until_callback_completes = &should_deinit_context;
            ctx.onResponse(this, prepared.js_request, response_value);
            ctx.defer_deinit_until_callback_completes = original_state;

            // Reference in the stack here in case it is not for whatever reason
            prepared.js_request.ensureStillAlive();

            if (should_deinit_context) {
                ctx.deinit();
                return;
            }

            if (ctx.shouldRenderMissing()) {
                ctx.renderMissing();
                return;
            }

            // The request is asynchronous, and all information from `req` must be copied
            // since the provided uws.Request will be re-used for future requests (stack allocated).
            switch (req) {
                .stack => |r| ctx.toAsync(r, prepared.request_object),
                .saved => {}, // info already copied
            }
        }

        pub const PreparedRequest = struct {
            js_request: JSValue,
            request_object: *Request,
            ctx: *RequestContext,

            /// This is used by DevServer for deferring calling the JS handler
            /// to until the bundle is actually ready.
            pub fn save(
                prepared: PreparedRequest,
                global: *JSC.JSGlobalObject,
                req: *uws.Request,
                resp: *App.Response,
            ) SavedRequest {
                // By saving a request, all information from `req` must be
                // copied since the provided uws.Request will be re-used for
                // future requests (stack allocated).
                prepared.ctx.toAsync(req, prepared.request_object);

                return .{
                    .js_request = .create(prepared.js_request, global),
                    .request = prepared.request_object,
                    .ctx = AnyRequestContext.init(prepared.ctx),
                    .response = uws.AnyResponse.init(resp),
                };
            }
        };

        pub fn prepareJsRequestContext(this: *ThisServer, req: *uws.Request, resp: *App.Response, should_deinit_context: ?*bool, create_js_request: bool, method: ?bun.http.Method) ?PreparedRequest {
            JSC.markBinding(@src());
            this.onPendingRequest();
            if (comptime Environment.isDebug) {
                this.vm.eventLoop().debug.enter();
            }
            defer {
                if (comptime Environment.isDebug) {
                    this.vm.eventLoop().debug.exit();
                }
            }
            req.setYield(false);
            resp.timeout(this.config.idleTimeout);

            // Since we do timeouts by default, we should tell the user when
            // this happens - but limit it to only warn once.
            if (shouldAddTimeoutHandlerForWarning(this)) {
                // We need to pass it a pointer, any pointer should do.
                resp.onTimeout(*anyopaque, onTimeoutForIdleWarn, &did_send_idletimeout_warning_once);
            }

            const ctx = this.request_pool_allocator.tryGet() catch bun.outOfMemory();
            ctx.create(this, req, resp, should_deinit_context, method);
            this.vm.jsc.reportExtraMemory(@sizeOf(RequestContext));
            const body = this.vm.initRequestBodyValue(.{ .Null = {} }) catch unreachable;

            ctx.request_body = body;
            var signal = JSC.WebCore.AbortSignal.new(this.globalThis);
            ctx.signal = signal;
            signal.pendingActivityRef();

            const request_object = Request.new(.{
                .method = ctx.method,
                .request_context = AnyRequestContext.init(ctx),
                .https = ssl_enabled,
                .signal = signal.ref(),
                .body = body.ref(),
            });
            ctx.request_weakref = .initRef(request_object);

            if (comptime debug_mode) {
                ctx.flags.is_web_browser_navigation = brk: {
                    if (req.header("sec-fetch-dest")) |fetch_dest| {
                        if (strings.eqlComptime(fetch_dest, "document")) {
                            break :brk true;
                        }
                    }

                    break :brk false;
                };
            }

            // we need to do this very early unfortunately
            // it seems to work fine for synchronous requests but anything async will take too long to register the handler
            // we do this only for HTTP methods that support request bodies, so not GET, HEAD, OPTIONS, or CONNECT.
            if ((HTTP.Method.which(req.method()) orelse HTTP.Method.OPTIONS).hasRequestBody()) {
                const req_len: usize = brk: {
                    if (req.header("content-length")) |content_length| {
                        break :brk std.fmt.parseInt(usize, content_length, 10) catch 0;
                    }

                    break :brk 0;
                };

                if (req_len > this.config.max_request_body_size) {
                    resp.writeStatus("413 Request Entity Too Large");
                    resp.endWithoutBody(true);
                    this.finalize();
                    return null;
                }

                ctx.request_body_content_len = req_len;
                ctx.flags.is_transfer_encoding = req.header("transfer-encoding") != null;
                if (req_len > 0 or ctx.flags.is_transfer_encoding) {
                    // we defer pre-allocating the body until we receive the first chunk
                    // that way if the client is lying about how big the body is or the client aborts
                    // we don't waste memory
                    ctx.request_body.?.value = .{
                        .Locked = .{
                            .task = ctx,
                            .global = this.globalThis,
                            .onStartBuffering = RequestContext.onStartBufferingCallback,
                            .onStartStreaming = RequestContext.onStartStreamingRequestBodyCallback,
                            .onReadableStreamAvailable = RequestContext.onRequestBodyReadableStreamAvailable,
                        },
                    };
                    ctx.flags.is_waiting_for_request_body = true;

                    resp.onData(*RequestContext, RequestContext.onBufferedBodyChunk, ctx);
                }
            }

            return .{
                .js_request = if (create_js_request) request_object.toJS(this.globalThis) else .zero,
                .request_object = request_object,
                .ctx = ctx,
            };
        }

        fn upgradeWebSocketUserRoute(this: *UserRoute, resp: *App.Response, req: *uws.Request, upgrade_ctx: *uws.SocketContext, method: ?bun.http.Method) void {
            const server = this.server;
            const index = this.id;

            var should_deinit_context = false;
            var prepared = server.prepareJsRequestContext(req, resp, &should_deinit_context, false, method) orelse return;
            prepared.ctx.upgrade_context = upgrade_ctx; // set the upgrade context
            const server_request_list = js.routeListGetCached(server.jsValueAssertAlive()).?;
            var response_value = Bun__ServerRouteList__callRoute(server.globalThis, index, prepared.request_object, server.jsValueAssertAlive(), server_request_list, &prepared.js_request, req);

            if (server.globalThis.tryTakeException()) |exception| {
                response_value = exception;
            }

            server.handleRequest(&should_deinit_context, prepared, req, response_value);
        }

        pub fn onWebSocketUpgrade(
            this: *ThisServer,
            resp: *App.Response,
            req: *uws.Request,
            upgrade_ctx: *uws.SocketContext,
            id: usize,
        ) void {
            JSC.markBinding(@src());
            if (id == 1) {
                // This is actually a UserRoute if id is 1 so it's safe to cast
                upgradeWebSocketUserRoute(@ptrCast(this), resp, req, upgrade_ctx, null);
                return;
            }
            // Access `this` as *ThisServer only if id is 0
            bun.assert(id == 0);
            if (this.config.onNodeHTTPRequest != .zero) {
                onNodeHTTPRequestWithUpgradeCtx(this, req, resp, upgrade_ctx);
                return;
            }
            if (this.config.onRequest == .zero) {
                // require fetch method to be set otherwise we dont know what route to call
                // this should be the fallback in case no route is provided to upgrade
                resp.writeStatus("403 Forbidden");
                resp.endWithoutBody(true);
                return;
            }
            this.pending_requests += 1;
            req.setYield(false);
            var ctx = this.request_pool_allocator.tryGet() catch bun.outOfMemory();
            var should_deinit_context = false;
            ctx.create(this, req, resp, &should_deinit_context, null);
            var body = this.vm.initRequestBodyValue(.{ .Null = {} }) catch unreachable;

            ctx.request_body = body;
            var signal = JSC.WebCore.AbortSignal.new(this.globalThis);
            ctx.signal = signal;

            var request_object = Request.new(.{
                .method = ctx.method,
                .request_context = AnyRequestContext.init(ctx),
                .https = ssl_enabled,
                .signal = signal.ref(),
                .body = body.ref(),
            });
            ctx.upgrade_context = upgrade_ctx;
            ctx.request_weakref = .initRef(request_object);
            // We keep the Request object alive for the duration of the request so that we can remove the pointer to the UWS request object.
            var args = [_]JSC.JSValue{
                request_object.toJS(this.globalThis),
                this.jsValueAssertAlive(),
            };
            const request_value = args[0];
            request_value.ensureStillAlive();

            const response_value = this.config.onRequest.call(this.globalThis, this.jsValueAssertAlive(), &args) catch |err|
                this.globalThis.takeException(err);
            defer {
                // uWS request will not live longer than this function
                request_object.request_context.detachRequest();
            }
            ctx.onResponse(
                this,
                request_value,
                response_value,
            );

            ctx.defer_deinit_until_callback_completes = null;

            if (should_deinit_context) {
                ctx.deinit();
                return;
            }

            if (ctx.shouldRenderMissing()) {
                ctx.renderMissing();
                return;
            }

            ctx.toAsync(req, request_object);
        }

        // https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
        fn onChromeDevToolsJSONRequest(this: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            if (comptime Environment.enable_logs)
                httplog("{s} - {s}", .{ req.method(), req.url() });

            const authorized = brk: {
                if (this.dev_server == null)
                    break :brk false;

                if (resp.getRemoteSocketInfo()) |*address| {
                    // IPv4 loopback addresses
                    if (strings.startsWith(address.ip, "127.")) {
                        break :brk true;
                    }

                    // IPv6 loopback addresses
                    if (strings.startsWith(address.ip, "::ffff:127.") or
                        strings.startsWith(address.ip, "::1") or
                        strings.eqlComptime(address.ip, "0:0:0:0:0:0:0:1"))
                    {
                        break :brk true;
                    }
                }

                break :brk false;
            };

            if (!authorized) {
                req.setYield(true);
                return;
            }

            // They need a 16 byte uuid. It needs to be somewhat consistent. We don't want to store this field anywhere.

            // So we first use a hash of the main field:
            const first_hash_segment: [8]u8 = brk: {
                const buffer = bun.PathBufferPool.get();
                defer bun.PathBufferPool.put(buffer);
                const main = JSC.VirtualMachine.get().main;
                const len = @min(main.len, buffer.len);
                break :brk @bitCast(bun.hash(bun.strings.copyLowercase(main[0..len], buffer[0..len])));
            };

            // And then we use a hash of their project root directory:
            const second_hash_segment: [8]u8 = brk: {
                const buffer = bun.PathBufferPool.get();
                defer bun.PathBufferPool.put(buffer);
                const root = this.dev_server.?.root;
                const len = @min(root.len, buffer.len);
                break :brk @bitCast(bun.hash(bun.strings.copyLowercase(root[0..len], buffer[0..len])));
            };

            // We combine it together to get a 16 byte uuid.
            const hash_bytes: [16]u8 = first_hash_segment ++ second_hash_segment;
            const uuid = bun.UUID.initWith(&hash_bytes);

            // interface DevToolsJSON {
            //   workspace?: {
            //     root: string,
            //     uuid: string,
            //   }
            // }
            const json_string = std.fmt.allocPrint(bun.default_allocator, "{{ \"workspace\": {{ \"root\": {}, \"uuid\": \"{}\" }} }}", .{
                bun.fmt.formatJSONStringUTF8(this.dev_server.?.root, .{}),
                uuid,
            }) catch bun.outOfMemory();
            defer bun.default_allocator.free(json_string);

            resp.writeStatus("200 OK");
            resp.writeHeader("Content-Type", "application/json");
            resp.end(json_string, resp.shouldCloseConnection());
        }

        fn setRoutes(this: *ThisServer) JSC.JSValue {
            var route_list_value = JSC.JSValue.zero;
            const app = this.app.?;
            const any_server = AnyServer.from(this);
            const dev_server = this.dev_server;

            // https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
            // Only enable this when we're using the dev server.
            var should_add_chrome_devtools_json_route = debug_mode and this.config.allow_hot and dev_server != null and this.config.enable_chrome_devtools_automatic_workspace_folders;
            const chrome_devtools_route = "/.well-known/appspecific/com.chrome.devtools.json";

            // --- 1. Handle user_routes_to_build (dynamic JS routes) ---
            // (This part remains conceptually the same: populate this.user_routes and route_list_value
            //  Crucially, ServerConfig.fromJS must ensure `route.method` is correctly .specific or .any)
            if (this.config.user_routes_to_build.items.len > 0) {
                var user_routes_to_build_list = this.config.user_routes_to_build.moveToUnmanaged();
                var old_user_routes = this.user_routes;
                defer {
                    for (old_user_routes.items) |*r| r.route.deinit();
                    old_user_routes.deinit(bun.default_allocator);
                }
                this.user_routes = std.ArrayListUnmanaged(UserRoute).initCapacity(bun.default_allocator, user_routes_to_build_list.items.len) catch @panic("OOM");
                const paths_zig = bun.default_allocator.alloc(ZigString, user_routes_to_build_list.items.len) catch @panic("OOM");
                defer bun.default_allocator.free(paths_zig);
                const callbacks_js = bun.default_allocator.alloc(JSC.JSValue, user_routes_to_build_list.items.len) catch @panic("OOM");
                defer bun.default_allocator.free(callbacks_js);

                for (user_routes_to_build_list.items, paths_zig, callbacks_js, 0..) |*builder, *p_zig, *cb_js, i| {
                    p_zig.* = ZigString.init(builder.route.path);
                    cb_js.* = builder.callback.get().?;
                    this.user_routes.appendAssumeCapacity(.{
                        .id = @truncate(i),
                        .server = this,
                        .route = builder.route,
                    });
                    builder.route = .{}; // Mark as moved
                }
                route_list_value = Bun__ServerRouteList__create(this.globalThis, callbacks_js.ptr, paths_zig.ptr, user_routes_to_build_list.items.len);
                for (user_routes_to_build_list.items) |*builder| builder.deinit();
                user_routes_to_build_list.deinit(bun.default_allocator);
            }

            // --- 2. Setup WebSocket handler's app reference ---
            if (this.config.websocket) |*websocket| {
                websocket.globalObject = this.globalThis;
                websocket.handler.app = app;
                websocket.handler.flags.ssl = ssl_enabled;
            }

            // --- 3. Register compiled user routes (this.user_routes) & Track "/*" Coverage ---
            var star_methods_covered_by_user = bun.http.Method.Set.initEmpty();
            var has_any_user_route_for_star_path = false; // True if "/*" path appears in user_routes at all
            var has_any_ws_route_for_star_path = false;

            for (this.user_routes.items) |*user_route| {
                const is_star_path = strings.eqlComptime(user_route.route.path, "/*");
                if (is_star_path) {
                    has_any_user_route_for_star_path = true;
                }

                if (should_add_chrome_devtools_json_route) {
                    if (strings.eqlComptime(user_route.route.path, chrome_devtools_route) or strings.hasPrefix(user_route.route.path, "/.well-known/")) {
                        should_add_chrome_devtools_json_route = false;
                    }
                }

                // Register HTTP routes
                switch (user_route.route.method) {
                    .any => {
                        app.any(user_route.route.path, *UserRoute, user_route, onUserRouteRequest);
                        if (is_star_path) {
                            star_methods_covered_by_user = .initFull();
                        }

                        if (this.config.websocket) |*websocket| {
                            if (is_star_path) {
                                has_any_ws_route_for_star_path = true;
                            }
                            app.ws(
                                user_route.route.path,
                                user_route,
                                1, // id 1 means is a user route
                                ServerWebSocket.behavior(ThisServer, ssl_enabled, websocket.toBehavior()),
                            );
                        }
                    },
                    .specific => |method_val| { // method_val is HTTP.Method here
                        app.method(method_val, user_route.route.path, *UserRoute, user_route, onUserRouteRequest);
                        if (is_star_path) {
                            star_methods_covered_by_user.insert(method_val);
                        }

                        // Setup user websocket in the route if needed.
                        if (this.config.websocket) |*websocket| {
                            // Websocket upgrade is a GET request
                            if (method_val == .GET) {
                                app.ws(
                                    user_route.route.path,
                                    user_route,
                                    1, // id 1 means is a user route
                                    ServerWebSocket.behavior(ThisServer, ssl_enabled, websocket.toBehavior()),
                                );
                            }
                        }
                    },
                }
            }

            // --- 4. Register negative routes ---
            for (this.config.negative_routes.items) |route_path| {
                app.head(route_path, *ThisServer, this, onRequest);
                app.any(route_path, *ThisServer, this, onRequest);
            }

            // --- 5. Register static routes & Track "/*" Coverage ---
            var needs_plugins = dev_server != null;
            var has_static_route_for_star_path = false;

            if (this.config.static_routes.items.len > 0) {
                for (this.config.static_routes.items) |*entry| {
                    if (strings.eqlComptime(entry.path, "/*")) {
                        has_static_route_for_star_path = true;
                        switch (entry.method) {
                            .any => {
                                star_methods_covered_by_user = .initFull();
                            },
                            .method => |method| {
                                star_methods_covered_by_user.setUnion(method);
                            },
                        }
                    }

                    if (should_add_chrome_devtools_json_route) {
                        if (strings.eqlComptime(entry.path, chrome_devtools_route) or strings.hasPrefix(entry.path, "/.well-known/")) {
                            should_add_chrome_devtools_json_route = false;
                        }
                    }

                    switch (entry.route) {
                        .static => |static_route| {
                            ServerConfig.applyStaticRoute(any_server, ssl_enabled, app, *StaticRoute, static_route, entry.path, entry.method);
                        },
                        .file => |file_route| {
                            ServerConfig.applyStaticRoute(any_server, ssl_enabled, app, *FileRoute, file_route, entry.path, entry.method);
                        },
                        .html => |html_bundle_route| {
                            ServerConfig.applyStaticRoute(any_server, ssl_enabled, app, *HTMLBundle.Route, html_bundle_route.data, entry.path, entry.method);
                            if (dev_server) |dev| {
                                dev.html_router.put(dev.allocator, entry.path, html_bundle_route.data) catch bun.outOfMemory();
                            }
                            needs_plugins = true;
                        },
                        .framework_router => {},
                    }
                }
            }

            // --- 6. Initialize plugins if needed ---
            if (needs_plugins and this.plugins == null) {
                if (this.vm.transpiler.options.serve_plugins) |serve_plugins_config| {
                    if (serve_plugins_config.len > 0) {
                        this.plugins = ServePlugins.init(serve_plugins_config);
                    }
                }
            }

            // --- 7. Debug mode specific routes ---
            if (debug_mode) {
                app.get("/bun:info", *ThisServer, this, onBunInfoRequest);
                if (this.config.inspector) {
                    JSC.markBinding(@src());
                    Bun__addInspector(ssl_enabled, app, this.globalThis);
                }
            }

            // --- 8. Handle DevServer routes & Track "/*" Coverage ---
            var has_dev_server_for_star_path = false;
            if (dev_server) |dev| {
                // dev.setRoutes might register its own "/*" HTTP handler
                has_dev_server_for_star_path = dev.setRoutes(this) catch bun.outOfMemory();
                if (has_dev_server_for_star_path) {
                    // Assume dev server "/*" covers all methods if it exists
                    star_methods_covered_by_user = .initFull();
                }
            }

            // Setup user websocket fallback route aka fetch function if fetch is not provided will respond with 403.
            if (!has_any_ws_route_for_star_path) {
                if (this.config.websocket) |*websocket| {
                    app.ws(
                        "/*",
                        this,
                        0, // id 0 means is a fallback route and ctx is the server
                        ServerWebSocket.behavior(ThisServer, ssl_enabled, websocket.toBehavior()),
                    );
                }
            }

            // --- 9. Consolidated "/*" HTTP Fallback Registration ---
            if (star_methods_covered_by_user.eql(bun.http.Method.Set.initFull())) {
                // User/Static/Dev has already provided a "/*" handler for ALL methods.
                // No further global "/*" HTTP fallback needed.
            } else if (has_any_user_route_for_star_path or has_static_route_for_star_path or has_dev_server_for_star_path) {
                // A "/*" route exists, but doesn't cover all methods.
                // Apply the global handler to the *remaining* methods for "/*".
                // So we flip the bits for the methods that are not covered by the user/static/dev routes
                star_methods_covered_by_user.toggleAll();
                var iter = star_methods_covered_by_user.iterator();
                while (iter.next()) |method_to_cover| {
                    switch (this.config.onNodeHTTPRequest) {
                        .zero => switch (this.config.onRequest) {
                            .zero => app.method(method_to_cover, "/*", *ThisServer, this, on404),
                            else => app.method(method_to_cover, "/*", *ThisServer, this, onRequest),
                        },
                        else => app.method(method_to_cover, "/*", *ThisServer, this, onNodeHTTPRequest),
                    }
                }
            } else {
                switch (this.config.onNodeHTTPRequest) {
                    .zero => switch (this.config.onRequest) {
                        .zero => app.any("/*", *ThisServer, this, on404),
                        else => app.any("/*", *ThisServer, this, onRequest),
                    },
                    else => app.any("/*", *ThisServer, this, onNodeHTTPRequest),
                }
            }

            if (should_add_chrome_devtools_json_route) {
                app.get(chrome_devtools_route, *ThisServer, this, onChromeDevToolsJSONRequest);
            }

            // If onNodeHTTPRequest is configured, it might be needed for Node.js compatibility layer
            // for specific Node API routes, even if it's not the main "/*" handler.
            if (this.config.onNodeHTTPRequest != .zero) {
                NodeHTTP_assignOnCloseFunction(ssl_enabled, app);
            }

            return route_list_value;
        }

        pub fn on404(_: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            if (comptime Environment.enable_logs)
                httplog("{s} - {s} 404", .{ req.method(), req.url() });

            resp.writeStatus("404 Not Found");

            // Rely on browser default page for now.
            resp.end("", false);
        }

        // TODO: make this return JSError!void, and do not deinitialize on synchronous failure, to allow errdefer in caller scope
        pub fn listen(this: *ThisServer) JSC.JSValue {
            httplog("listen", .{});
            var app: *App = undefined;
            const globalThis = this.globalThis;
            var route_list_value = JSC.JSValue.zero;
            if (ssl_enabled) {
                bun.BoringSSL.load();
                const ssl_config = this.config.ssl_config orelse @panic("Assertion failure: ssl_config");
                const ssl_options = ssl_config.asUSockets();

                app = App.create(ssl_options) orelse {
                    if (!globalThis.hasException()) {
                        if (!throwSSLErrorIfNecessary(globalThis)) {
                            globalThis.throw("Failed to create HTTP server", .{}) catch {};
                        }
                    }

                    this.app = null;
                    this.deinit();
                    return .zero;
                };

                this.app = app;

                route_list_value = this.setRoutes();

                // add serverName to the SSL context using default ssl options
                if (ssl_config.server_name) |server_name_ptr| {
                    const server_name: [:0]const u8 = std.mem.span(server_name_ptr);
                    if (server_name.len > 0) {
                        app.addServerNameWithOptions(server_name, ssl_options) catch {
                            if (!globalThis.hasException()) {
                                if (!throwSSLErrorIfNecessary(globalThis)) {
                                    globalThis.throw("Failed to add serverName: {s}", .{server_name}) catch {};
                                }
                            }

                            this.deinit();
                            return .zero;
                        };
                        if (throwSSLErrorIfNecessary(globalThis)) {
                            this.deinit();
                            return .zero;
                        }

                        app.domain(server_name);
                        if (throwSSLErrorIfNecessary(globalThis)) {
                            this.deinit();
                            return .zero;
                        }

                        // Ensure the routes are set for that domain name.
                        _ = this.setRoutes();
                    }
                }

                // apply SNI routes if any
                if (this.config.sni) |*sni| {
                    for (sni.slice()) |*sni_ssl_config| {
                        const sni_servername: [:0]const u8 = std.mem.span(sni_ssl_config.server_name);
                        if (sni_servername.len > 0) {
                            app.addServerNameWithOptions(sni_servername, sni_ssl_config.asUSockets()) catch {
                                if (!globalThis.hasException()) {
                                    if (!throwSSLErrorIfNecessary(globalThis)) {
                                        globalThis.throw("Failed to add serverName: {s}", .{sni_servername}) catch {};
                                    }
                                }

                                this.deinit();
                                return .zero;
                            };

                            app.domain(sni_servername);

                            if (throwSSLErrorIfNecessary(globalThis)) {
                                this.deinit();
                                return .zero;
                            }

                            // Ensure the routes are set for that domain name.
                            _ = this.setRoutes();
                        }
                    }
                }
            } else {
                app = App.create(.{}) orelse {
                    if (!globalThis.hasException()) {
                        globalThis.throw("Failed to create HTTP server", .{}) catch {};
                    }
                    this.deinit();
                    return .zero;
                };
                this.app = app;

                route_list_value = this.setRoutes();
            }

            if (this.config.onNodeHTTPRequest != .zero) {
                this.setUsingCustomExpectHandler(true);
            }

            switch (this.config.address) {
                .tcp => |tcp| {
                    var host: ?[*:0]const u8 = null;
                    var host_buff: [1024:0]u8 = undefined;

                    if (tcp.hostname) |existing| {
                        const hostname = bun.span(existing);

                        if (hostname.len > 2 and hostname[0] == '[') {
                            // remove "[" and "]" from hostname
                            host = std.fmt.bufPrintZ(&host_buff, "{s}", .{hostname[1 .. hostname.len - 1]}) catch unreachable;
                        } else {
                            host = tcp.hostname;
                        }
                    }

                    app.listenWithConfig(*ThisServer, this, onListen, .{
                        .port = tcp.port,
                        .host = host,
                        .options = this.config.getUsocketsOptions(),
                    });
                },

                .unix => |unix| {
                    app.listenOnUnixSocket(
                        *ThisServer,
                        this,
                        onListen,
                        unix,
                        this.config.getUsocketsOptions(),
                    );
                },
            }

            if (globalThis.hasException()) {
                this.deinit();
                return .zero;
            }

            this.ref();

            // Starting up an HTTP server is a good time to GC
            if (this.vm.aggressive_garbage_collection == .aggressive) {
                this.vm.autoGarbageCollect();
            } else {
                this.vm.eventLoop().performGC();
            }

            return route_list_value;
        }

        pub fn onClientErrorCallback(this: *ThisServer, socket: *uws.Socket, error_code: u8, raw_packet: []const u8) void {
            if (this.on_clienterror.get()) |callback| {
                const is_ssl = protocol_enum == .https;
                const node_socket = Bun__createNodeHTTPServerSocket(is_ssl, socket, this.globalThis);
                if (node_socket.isEmptyOrUndefinedOrNull()) {
                    return;
                }

                const error_code_value = JSValue.jsNumber(error_code);
                const raw_packet_value = JSC.ArrayBuffer.createBuffer(this.globalThis, raw_packet);
                const loop = this.globalThis.bunVM().eventLoop();
                loop.enter();
                defer loop.exit();
                _ = callback.call(this.globalThis, .js_undefined, &.{ JSValue.jsBoolean(is_ssl), node_socket, error_code_value, raw_packet_value }) catch |err| {
                    this.globalThis.reportActiveExceptionAsUnhandled(err);
                };
            }
        }
    };
}

pub const AnyRequestContext = @import("./server/AnyRequestContext.zig");
pub const NewRequestContext = @import("./server/RequestContext.zig").NewRequestContext;

pub const SavedRequest = struct {
    js_request: JSC.Strong.Optional,
    request: *Request,
    ctx: AnyRequestContext,
    response: uws.AnyResponse,

    pub fn deinit(sr: *SavedRequest) void {
        sr.js_request.deinit();
        sr.ctx.deref();
    }

    pub const Union = union(enum) {
        stack: *uws.Request,
        saved: bun.JSC.API.SavedRequest,
    };
};

pub const ServerAllConnectionsClosedTask = struct {
    globalObject: *JSC.JSGlobalObject,
    promise: JSC.JSPromise.Strong,
    tracker: JSC.Debugger.AsyncTaskTracker,

    pub const new = bun.TrivialNew(@This());

    pub fn runFromJSThread(this: *ServerAllConnectionsClosedTask, vm: *JSC.VirtualMachine) void {
        httplog("ServerAllConnectionsClosedTask runFromJSThread", .{});

        const globalObject = this.globalObject;
        const tracker = this.tracker;
        tracker.willDispatch(globalObject);
        defer tracker.didDispatch(globalObject);

        var promise = this.promise;
        defer promise.deinit();
        bun.destroy(this);

        if (!vm.isShuttingDown()) {
            promise.resolve(globalObject, .js_undefined);
        }
    }
};

pub const HTTPServer = NewServer(.http, .production);
pub const HTTPSServer = NewServer(.https, .production);
pub const DebugHTTPServer = NewServer(.http, .debug);
pub const DebugHTTPSServer = NewServer(.https, .debug);
pub const AnyServer = struct {
    ptr: Ptr,

    pub const Ptr = bun.TaggedPointerUnion(.{
        HTTPServer,
        HTTPSServer,
        DebugHTTPServer,
        DebugHTTPSServer,
    });

    pub const AnyUserRouteList = union(enum) {
        HTTPServer: []const HTTPServer.UserRoute,
        HTTPSServer: []const HTTPSServer.UserRoute,
        DebugHTTPServer: []const DebugHTTPServer.UserRoute,
        DebugHTTPSServer: []const DebugHTTPSServer.UserRoute,
    };

    pub fn userRoutes(this: AnyServer) AnyUserRouteList {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => .{ .HTTPServer = this.ptr.as(HTTPServer).user_routes.items },
            Ptr.case(HTTPSServer) => .{ .HTTPSServer = this.ptr.as(HTTPSServer).user_routes.items },
            Ptr.case(DebugHTTPServer) => .{ .DebugHTTPServer = this.ptr.as(DebugHTTPServer).user_routes.items },
            Ptr.case(DebugHTTPSServer) => .{ .DebugHTTPSServer = this.ptr.as(DebugHTTPSServer).user_routes.items },
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn getURLAsString(this: AnyServer) bun.OOM!bun.String {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).getURLAsString(),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).getURLAsString(),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).getURLAsString(),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).getURLAsString(),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }
    pub fn vm(this: AnyServer) *JSC.VirtualMachine {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).vm,
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).vm,
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).vm,
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).vm,
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }
    pub fn setInspectorServerID(this: AnyServer, id: JSC.Debugger.DebuggerId) void {
        switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => {
                this.ptr.as(HTTPServer).inspector_server_id = id;
                if (this.ptr.as(HTTPServer).dev_server) |dev_server| {
                    dev_server.inspector_server_id = id;
                }
            },
            Ptr.case(HTTPSServer) => {
                this.ptr.as(HTTPSServer).inspector_server_id = id;
                if (this.ptr.as(HTTPSServer).dev_server) |dev_server| {
                    dev_server.inspector_server_id = id;
                }
            },
            Ptr.case(DebugHTTPServer) => {
                this.ptr.as(DebugHTTPServer).inspector_server_id = id;
                if (this.ptr.as(DebugHTTPServer).dev_server) |dev_server| {
                    dev_server.inspector_server_id = id;
                }
            },
            Ptr.case(DebugHTTPSServer) => {
                this.ptr.as(DebugHTTPSServer).inspector_server_id = id;
                if (this.ptr.as(DebugHTTPSServer).dev_server) |dev_server| {
                    dev_server.inspector_server_id = id;
                }
            },
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        }
    }

    pub fn inspectorServerID(this: AnyServer) JSC.Debugger.DebuggerId {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).inspector_server_id,
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).inspector_server_id,
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).inspector_server_id,
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).inspector_server_id,
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn plugins(this: AnyServer) ?*ServePlugins {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).plugins,
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).plugins,
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).plugins,
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).plugins,
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn getPlugins(this: AnyServer) PluginsResult {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).getPlugins(),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).getPlugins(),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).getPlugins(),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).getPlugins(),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn loadAndResolvePlugins(this: AnyServer, bundle: *HTMLBundle.HTMLBundleRoute, raw_plugins: []const []const u8, bunfig_path: []const u8) void {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).getPluginsAsync(bundle, raw_plugins, bunfig_path),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).getPluginsAsync(bundle, raw_plugins, bunfig_path),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).getPluginsAsync(bundle, raw_plugins, bunfig_path),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).getPluginsAsync(bundle, raw_plugins, bunfig_path),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    /// Returns:
    /// - .ready if no plugin has to be loaded
    /// - .err if there is a cached failure. Currently, this requires restarting the entire server.
    /// - .pending if `callback` was stored. It will call `onPluginsResolved` or `onPluginsRejected` later.
    pub fn getOrLoadPlugins(server: AnyServer, callback: ServePlugins.Callback) ServePlugins.GetOrStartLoadResult {
        return switch (server.ptr.tag()) {
            Ptr.case(HTTPServer) => server.ptr.as(HTTPServer).getOrLoadPlugins(callback),
            Ptr.case(HTTPSServer) => server.ptr.as(HTTPSServer).getOrLoadPlugins(callback),
            Ptr.case(DebugHTTPServer) => server.ptr.as(DebugHTTPServer).getOrLoadPlugins(callback),
            Ptr.case(DebugHTTPSServer) => server.ptr.as(DebugHTTPSServer).getOrLoadPlugins(callback),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn reloadStaticRoutes(this: AnyServer) !bool {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).reloadStaticRoutes(),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).reloadStaticRoutes(),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).reloadStaticRoutes(),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).reloadStaticRoutes(),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn appendStaticRoute(this: AnyServer, path: []const u8, route: AnyRoute, method: HTTP.Method.Optional) !void {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).appendStaticRoute(path, route, method),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).appendStaticRoute(path, route, method),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).appendStaticRoute(path, route, method),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).appendStaticRoute(path, route, method),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn globalThis(this: AnyServer) *JSC.JSGlobalObject {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).globalThis,
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).globalThis,
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).globalThis,
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).globalThis,
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn config(this: AnyServer) *const ServerConfig {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => &this.ptr.as(HTTPServer).config,
            Ptr.case(HTTPSServer) => &this.ptr.as(HTTPSServer).config,
            Ptr.case(DebugHTTPServer) => &this.ptr.as(DebugHTTPServer).config,
            Ptr.case(DebugHTTPSServer) => &this.ptr.as(DebugHTTPSServer).config,
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn webSocketHandler(this: AnyServer) ?*WebSocketServerContext.Handler {
        const server_config: *ServerConfig = switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => &this.ptr.as(HTTPServer).config,
            Ptr.case(HTTPSServer) => &this.ptr.as(HTTPSServer).config,
            Ptr.case(DebugHTTPServer) => &this.ptr.as(DebugHTTPServer).config,
            Ptr.case(DebugHTTPSServer) => &this.ptr.as(DebugHTTPSServer).config,
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
        if (server_config.websocket == null) return null;
        return &server_config.websocket.?.handler;
    }

    pub fn onRequest(
        this: AnyServer,
        req: *uws.Request,
        resp: *uws.NewApp(false).Response,
    ) void {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).onRequest(req, resp),
            Ptr.case(HTTPSServer) => @panic("TODO: https"),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).onRequest(req, resp),
            Ptr.case(DebugHTTPSServer) => @panic("TODO: https"),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn from(server: anytype) AnyServer {
        return .{ .ptr = Ptr.init(server) };
    }

    pub fn onPendingRequest(this: AnyServer) void {
        switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).onPendingRequest(),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).onPendingRequest(),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).onPendingRequest(),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).onPendingRequest(),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        }
    }

    pub fn onRequestComplete(this: AnyServer) void {
        switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).onRequestComplete(),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).onRequestComplete(),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).onRequestComplete(),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).onRequestComplete(),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        }
    }

    pub fn onStaticRequestComplete(this: AnyServer) void {
        switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).onStaticRequestComplete(),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).onStaticRequestComplete(),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).onStaticRequestComplete(),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).onStaticRequestComplete(),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        }
    }

    pub fn publish(this: AnyServer, topic: []const u8, message: []const u8, opcode: uws.Opcode, compress: bool) bool {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).app.?.publish(topic, message, opcode, compress),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).app.?.publish(topic, message, opcode, compress),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).app.?.publish(topic, message, opcode, compress),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).app.?.publish(topic, message, opcode, compress),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn onRequestFromSaved(
        this: AnyServer,
        req: SavedRequest.Union,
        resp: uws.AnyResponse,
        callback: JSC.JSValue,
        comptime extra_arg_count: usize,
        extra_args: [extra_arg_count]JSValue,
    ) void {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).onRequestFromSaved(req, resp.TCP, callback, extra_arg_count, extra_args),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).onRequestFromSaved(req, resp.SSL, callback, extra_arg_count, extra_args),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).onRequestFromSaved(req, resp.TCP, callback, extra_arg_count, extra_args),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).onRequestFromSaved(req, resp.SSL, callback, extra_arg_count, extra_args),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn prepareAndSaveJsRequestContext(
        server: AnyServer,
        req: *uws.Request,
        resp: uws.AnyResponse,
        global: *JSC.JSGlobalObject,
        method: ?bun.http.Method,
    ) ?SavedRequest {
        return switch (server.ptr.tag()) {
            Ptr.case(HTTPServer) => (server.ptr.as(HTTPServer).prepareJsRequestContext(req, resp.TCP, null, true, method) orelse return null).save(global, req, resp.TCP),
            Ptr.case(HTTPSServer) => (server.ptr.as(HTTPSServer).prepareJsRequestContext(req, resp.SSL, null, true, method) orelse return null).save(global, req, resp.SSL),
            Ptr.case(DebugHTTPServer) => (server.ptr.as(DebugHTTPServer).prepareJsRequestContext(req, resp.TCP, null, true, method) orelse return null).save(global, req, resp.TCP),
            Ptr.case(DebugHTTPSServer) => (server.ptr.as(DebugHTTPSServer).prepareJsRequestContext(req, resp.SSL, null, true, method) orelse return null).save(global, req, resp.SSL),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }
    pub fn numSubscribers(this: AnyServer, topic: []const u8) u32 {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).app.?.numSubscribers(topic),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).app.?.numSubscribers(topic),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).app.?.numSubscribers(topic),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).app.?.numSubscribers(topic),
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }

    pub fn devServer(this: AnyServer) ?*bun.bake.DevServer {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).dev_server,
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).dev_server,
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).dev_server,
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).dev_server,
            else => bun.unreachablePanic("Invalid pointer tag", .{}),
        };
    }
};

extern fn Bun__addInspector(bool, *anyopaque, *JSC.JSGlobalObject) void;

const assert = bun.assert;

pub export fn Server__setIdleTimeout(server: JSC.JSValue, seconds: JSC.JSValue, globalThis: *JSC.JSGlobalObject) void {
    Server__setIdleTimeout_(server, seconds, globalThis) catch |err| switch (err) {
        error.JSError => {},
        error.OutOfMemory => {
            _ = globalThis.throwOutOfMemoryValue();
        },
    };
}

pub fn Server__setIdleTimeout_(server: JSC.JSValue, seconds: JSC.JSValue, globalThis: *JSC.JSGlobalObject) bun.JSError!void {
    if (!server.isObject()) {
        return globalThis.throw("Failed to set timeout: The 'this' value is not a Server.", .{});
    }

    if (!seconds.isNumber()) {
        return globalThis.throw("Failed to set timeout: The provided value is not of type 'number'.", .{});
    }
    const value = seconds.to(c_uint);
    if (server.as(HTTPServer)) |this| {
        this.setIdleTimeout(value);
    } else if (server.as(HTTPSServer)) |this| {
        this.setIdleTimeout(value);
    } else if (server.as(DebugHTTPServer)) |this| {
        this.setIdleTimeout(value);
    } else if (server.as(DebugHTTPSServer)) |this| {
        this.setIdleTimeout(value);
    } else {
        return globalThis.throw("Failed to set timeout: The 'this' value is not a Server.", .{});
    }
}

pub fn Server__setOnClientError_(globalThis: *JSC.JSGlobalObject, server: JSC.JSValue, callback: JSC.JSValue) bun.JSError!JSC.JSValue {
    if (!server.isObject()) {
        return globalThis.throw("Failed to set clientError: The 'this' value is not a Server.", .{});
    }

    if (!callback.isFunction()) {
        return globalThis.throw("Failed to set clientError: The provided value is not a function.", .{});
    }

    if (server.as(HTTPServer)) |this| {
        if (this.app) |app| {
            this.on_clienterror.deinit();
            this.on_clienterror = JSC.Strong.Optional.create(callback, globalThis);
            app.onClientError(*HTTPServer, this, HTTPServer.onClientErrorCallback);
        }
    } else if (server.as(HTTPSServer)) |this| {
        if (this.app) |app| {
            this.on_clienterror.deinit();
            this.on_clienterror = JSC.Strong.Optional.create(callback, globalThis);
            app.onClientError(*HTTPSServer, this, HTTPSServer.onClientErrorCallback);
        }
    } else if (server.as(DebugHTTPServer)) |this| {
        if (this.app) |app| {
            this.on_clienterror.deinit();
            this.on_clienterror = JSC.Strong.Optional.create(callback, globalThis);
            app.onClientError(*DebugHTTPServer, this, DebugHTTPServer.onClientErrorCallback);
        }
    } else if (server.as(DebugHTTPSServer)) |this| {
        if (this.app) |app| {
            this.on_clienterror.deinit();
            this.on_clienterror = JSC.Strong.Optional.create(callback, globalThis);
            app.onClientError(*DebugHTTPSServer, this, DebugHTTPSServer.onClientErrorCallback);
        }
    } else {
        bun.debugAssert(false);
    }
    return .js_undefined;
}

pub fn Server__setAppFlags_(globalThis: *JSC.JSGlobalObject, server: JSC.JSValue, require_host_header: bool, use_strict_method_validation: bool) bun.JSError!JSC.JSValue {
    if (!server.isObject()) {
        return globalThis.throw("Failed to set requireHostHeader: The 'this' value is not a Server.", .{});
    }

    if (server.as(HTTPServer)) |this| {
        this.setFlags(require_host_header, use_strict_method_validation);
    } else if (server.as(HTTPSServer)) |this| {
        this.setFlags(require_host_header, use_strict_method_validation);
    } else if (server.as(DebugHTTPServer)) |this| {
        this.setFlags(require_host_header, use_strict_method_validation);
    } else if (server.as(DebugHTTPSServer)) |this| {
        this.setFlags(require_host_header, use_strict_method_validation);
    } else {
        return globalThis.throw("Failed to set timeout: The 'this' value is not a Server.", .{});
    }
    return .js_undefined;
}

pub fn Server__setMaxHTTPHeaderSize_(globalThis: *JSC.JSGlobalObject, server: JSC.JSValue, max_header_size: u64) bun.JSError!JSC.JSValue {
    if (!server.isObject()) {
        return globalThis.throw("Failed to set maxHeaderSize: The 'this' value is not a Server.", .{});
    }

    if (server.as(HTTPServer)) |this| {
        this.setMaxHTTPHeaderSize(max_header_size);
    } else if (server.as(HTTPSServer)) |this| {
        this.setMaxHTTPHeaderSize(max_header_size);
    } else if (server.as(DebugHTTPServer)) |this| {
        this.setMaxHTTPHeaderSize(max_header_size);
    } else if (server.as(DebugHTTPSServer)) |this| {
        this.setMaxHTTPHeaderSize(max_header_size);
    } else {
        return globalThis.throw("Failed to set maxHeaderSize: The 'this' value is not a Server.", .{});
    }
    return .js_undefined;
}
comptime {
    _ = Server__setIdleTimeout;
    _ = NodeHTTPResponse.create;
    @export(&JSC.host_fn.wrap4(Server__setAppFlags_), .{ .name = "Server__setAppFlags" });
    @export(&JSC.host_fn.wrap3(Server__setOnClientError_), .{ .name = "Server__setOnClientError" });
    @export(&JSC.host_fn.wrap3(Server__setMaxHTTPHeaderSize_), .{ .name = "Server__setMaxHTTPHeaderSize" });
}

extern fn NodeHTTPServer__onRequest_http(
    any_server: usize,
    globalThis: *JSC.JSGlobalObject,
    this: JSC.JSValue,
    callback: JSC.JSValue,
    methodString: JSC.JSValue,
    request: *uws.Request,
    response: *uws.NewApp(false).Response,
    upgrade_ctx: ?*uws.SocketContext,
    node_response_ptr: *?*NodeHTTPResponse,
) JSC.JSValue;

extern fn NodeHTTPServer__onRequest_https(
    any_server: usize,
    globalThis: *JSC.JSGlobalObject,
    this: JSC.JSValue,
    callback: JSC.JSValue,
    methodString: JSC.JSValue,
    request: *uws.Request,
    response: *uws.NewApp(true).Response,
    upgrade_ctx: ?*uws.SocketContext,
    node_response_ptr: *?*NodeHTTPResponse,
) JSC.JSValue;

extern fn Bun__createNodeHTTPServerSocket(bool, *anyopaque, *JSC.JSGlobalObject) JSC.JSValue;
extern fn NodeHTTP_assignOnCloseFunction(bool, *anyopaque) void;
extern fn NodeHTTP_setUsingCustomExpectHandler(bool, *anyopaque, bool) void;
extern "c" fn Bun__ServerRouteList__callRoute(
    globalObject: *JSC.JSGlobalObject,
    index: u32,
    requestPtr: *Request,
    serverObject: JSC.JSValue,
    routeListObject: JSC.JSValue,
    requestObject: *JSC.JSValue,
    req: *uws.Request,
) JSC.JSValue;

extern "c" fn Bun__ServerRouteList__create(
    globalObject: *JSC.JSGlobalObject,
    callbacks: [*]JSC.JSValue,
    paths: [*]ZigString,
    pathsLength: usize,
) JSC.JSValue;

fn throwSSLErrorIfNecessary(globalThis: *JSC.JSGlobalObject) bool {
    const err_code = BoringSSL.ERR_get_error();
    if (err_code != 0) {
        defer BoringSSL.ERR_clear_error();
        globalThis.throwValue(JSC.API.Bun.Crypto.createCryptoError(globalThis, err_code)) catch {};
        return true;
    }

    return false;
}
