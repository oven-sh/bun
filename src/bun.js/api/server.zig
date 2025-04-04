const Bun = @This();
const default_allocator = bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;
const AnyBlob = bun.JSC.WebCore.AnyBlob;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const MutableString = bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const Fs = @import("../../fs.zig");
const Resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const Sys = @import("../../sys.zig");

const MacroEntryPoint = bun.transpiler.MacroEntryPoint;
const logger = bun.logger;
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Transpiler = bun.Transpiler;
const ServerEntryPoint = bun.transpiler.ServerEntryPoint;
const js_printer = bun.js_printer;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const NodeFallbackModules = @import("../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../analytics/analytics_thread.zig");
const ZigString = bun.JSC.ZigString;
const Runtime = @import("../../runtime.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../env_loader.zig");
const ParseResult = bun.transpiler.ParseResult;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../resolver/package_json.zig").MacroMap;
const WebCore = bun.JSC.WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const HTTP = bun.http;
const FetchEvent = WebCore.FetchEvent;
const js = bun.JSC.C;
const JSC = bun.JSC;
const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = bun.JSC.JSValue;

const JSGlobalObject = bun.JSC.JSGlobalObject;
const ExceptionValueRef = bun.JSC.ExceptionValueRef;
const JSPrivateDataPtr = bun.JSC.JSPrivateDataPtr;
const ConsoleObject = bun.JSC.ConsoleObject;
const Node = bun.JSC.Node;
const ZigException = bun.JSC.ZigException;
const ZigStackTrace = bun.JSC.ZigStackTrace;
const ErrorableResolvedSource = bun.JSC.ErrorableResolvedSource;
const ResolvedSource = bun.JSC.ResolvedSource;
const JSPromise = bun.JSC.JSPromise;
const JSInternalPromise = bun.JSC.JSInternalPromise;
const JSModuleLoader = bun.JSC.JSModuleLoader;
const JSPromiseRejectionOperation = bun.JSC.JSPromiseRejectionOperation;
const ErrorableZigString = bun.JSC.ErrorableZigString;
const VM = bun.JSC.VM;
const JSFunction = bun.JSC.JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../url.zig").URL;
const VirtualMachine = JSC.VirtualMachine;
const IOTask = JSC.IOTask;
const uws = bun.uws;
const Fallback = Runtime.Fallback;
const MimeType = HTTP.MimeType;
const Blob = JSC.WebCore.Blob;
const BoringSSL = bun.BoringSSL.c;
const Arena = @import("../../allocators/mimalloc_arena.zig").Arena;
const SendfileContext = struct {
    fd: bun.FileDescriptor,
    socket_fd: bun.FileDescriptor = bun.invalid_fd,
    remain: Blob.SizeType = 0,
    offset: Blob.SizeType = 0,
    has_listener: bool = false,
    has_set_on_writable: bool = false,
    auto_close: bool = false,
};
const linux = std.os.linux;
const Async = bun.Async;
const httplog = Output.scoped(.Server, false);
const ctxLog = Output.scoped(.RequestContext, false);
const S3 = bun.S3;
const SocketAddress = @import("bun/socket.zig").SocketAddress;

const BlobFileContentResult = struct {
    data: [:0]const u8,

    fn init(comptime fieldname: []const u8, js_obj: JSC.JSValue, global: *JSC.JSGlobalObject) bun.JSError!?BlobFileContentResult {
        {
            const body = try JSC.WebCore.Body.Value.fromJS(global, js_obj);
            if (body == .Blob and body.Blob.store != null and body.Blob.store.?.data == .file) {
                var fs: JSC.Node.NodeFS = .{};
                const read = fs.readFileWithOptions(.{ .path = body.Blob.store.?.data.file.pathlike }, .sync, .null_terminated);
                switch (read) {
                    .err => {
                        return global.throwValue(read.err.toJSC(global));
                    },
                    else => {
                        const str = read.result.null_terminated;
                        if (str.len > 0) {
                            return .{ .data = str };
                        }
                        return global.throwInvalidArguments(std.fmt.comptimePrint("Invalid {s} file", .{fieldname}), .{});
                    },
                }
            }
        }

        return null;
    }
};

fn getContentType(headers: ?*JSC.FetchHeaders, blob: *const JSC.WebCore.AnyBlob, allocator: std.mem.Allocator) struct { MimeType, bool, bool } {
    var needs_content_type = true;
    var content_type_needs_free = false;

    const content_type: MimeType = brk: {
        if (headers) |headers_| {
            if (headers_.fastGet(.ContentType)) |content| {
                needs_content_type = false;

                var content_slice = content.toSlice(allocator);
                defer content_slice.deinit();

                const content_type_allocator = if (content_slice.allocator.isNull()) null else allocator;
                break :brk MimeType.init(content_slice.slice(), content_type_allocator, &content_type_needs_free);
            }
        }

        break :brk if (blob.contentType().len > 0)
            MimeType.byName(blob.contentType())
        else if (MimeType.sniff(blob.slice())) |content|
            content
        else if (blob.wasString())
            MimeType.text
                // TODO: should we get the mime type off of the Blob.Store if it exists?
                // A little wary of doing this right now due to causing some breaking change
        else
            MimeType.other;
    };

    return .{ content_type, needs_content_type, content_type_needs_free };
}

fn validateRouteName(global: *JSC.JSGlobalObject, path: []const u8) !void {
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

        const entry = duped_route_names.getOrPut(route_name) catch bun.outOfMemory();
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

fn writeHeaders(
    headers: *JSC.FetchHeaders,
    comptime ssl: bool,
    resp_ptr: ?*uws.NewApp(ssl).Response,
) void {
    ctxLog("writeHeaders", .{});
    headers.fastRemove(.ContentLength);
    headers.fastRemove(.TransferEncoding);
    if (resp_ptr) |resp| {
        headers.toUWSResponse(ssl, resp);
    }
}

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

const HTMLBundle = JSC.API.HTMLBundle;

pub const AnyRoute = union(enum) {
    /// Serve a static file
    /// "/robots.txt": new Response(...),
    static: *StaticRoute,
    /// Bundle an HTML import
    /// import html from "./index.html";
    /// "/": html,
    html: *HTMLBundle.Route,
    /// Use file system routing.
    /// "/*": {
    ///   "dir": import.meta.resolve("./pages"),
    ///   "style": "nextjs-pages",
    /// }
    framework_router: bun.bake.FrameworkRouter.Type.Index,

    pub fn memoryCost(this: AnyRoute) usize {
        return switch (this) {
            .static => |static_route| static_route.memoryCost(),
            .html => |html_bundle_route| html_bundle_route.memoryCost(),
            .framework_router => @sizeOf(bun.bake.Framework.FileSystemRouterType),
        };
    }

    pub fn setServer(this: AnyRoute, server: ?AnyServer) void {
        switch (this) {
            .static => |static_route| static_route.server = server,
            .html => |html_bundle_route| html_bundle_route.server = server,
            .framework_router => {}, // DevServer contains .server field
        }
    }

    pub fn deref(this: AnyRoute) void {
        switch (this) {
            .static => |static_route| static_route.deref(),
            .html => |html_bundle_route| html_bundle_route.deref(),
            .framework_router => {}, // not reference counted
        }
    }

    pub fn ref(this: AnyRoute) void {
        switch (this) {
            .static => |static_route| static_route.ref(),
            .html => |html_bundle_route| html_bundle_route.ref(),
            .framework_router => {}, // not reference counted
        }
    }

    pub fn fromJS(
        global: *JSC.JSGlobalObject,
        path: []const u8,
        argument: JSC.JSValue,
        init_ctx: *ServerInitContext,
    ) bun.JSError!AnyRoute {
        if (argument.as(HTMLBundle)) |html_bundle| {
            const entry = try init_ctx.dedupe_html_bundle_map.getOrPut(html_bundle);
            if (!entry.found_existing) {
                entry.value_ptr.* = HTMLBundle.Route.init(html_bundle);
            } else {
                entry.value_ptr.*.ref();
            }

            return .{ .html = entry.value_ptr.* };
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

        return .{ .static = try StaticRoute.fromJS(global, argument) };
    }
};

pub const ServerInitContext = struct {
    arena: std.heap.ArenaAllocator,
    dedupe_html_bundle_map: std.AutoHashMap(*HTMLBundle, *HTMLBundle.Route),
    js_string_allocations: bun.bake.StringRefList,
    framework_router_list: std.ArrayList(bun.bake.Framework.FileSystemRouterType),
};

const UserRouteBuilder = struct {
    route: RouteDeclaration,
    callback: JSC.Strong = .empty,

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

    pub fn deinit(this: *UserRouteBuilder) void {
        this.route.deinit();
        this.callback.deinit();
    }
};

pub const ServerConfig = struct {
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

    onError: JSC.JSValue = JSC.JSValue.zero,
    onRequest: JSC.JSValue = JSC.JSValue.zero,
    onNodeHTTPRequest: JSC.JSValue = JSC.JSValue.zero,

    websocket: ?WebSocketServer = null,

    inspector: bool = false,
    reuse_port: bool = false,
    id: []const u8 = "",
    allow_hot: bool = true,
    ipv6_only: bool = false,

    is_node_http: bool = false,
    had_routes_object: bool = false,

    static_routes: std.ArrayList(StaticRouteEntry) = std.ArrayList(StaticRouteEntry).init(bun.default_allocator),
    negative_routes: std.ArrayList([:0]const u8) = std.ArrayList([:0]const u8).init(bun.default_allocator),
    user_routes_to_build: std.ArrayList(UserRouteBuilder) = std.ArrayList(UserRouteBuilder).init(bun.default_allocator),

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

    // TODO: rename to StaticRoute.Entry
    pub const StaticRouteEntry = struct {
        path: []const u8,
        route: AnyRoute,

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
            };
        }

        pub fn deinit(this: *StaticRouteEntry) void {
            bun.default_allocator.free(this.path);
            this.route.deref();
        }

        pub fn isLessThan(_: void, this: StaticRouteEntry, other: StaticRouteEntry) bool {
            return strings.cmpStringsDesc({}, this.path, other.path);
        }
    };

    pub fn cloneForReloadingStaticRoutes(this: *ServerConfig) !ServerConfig {
        var that = this.*;
        this.ssl_config = null;
        this.sni = null;
        this.address = .{ .tcp = .{} };
        this.websocket = null;
        this.bake = null;

        var static_routes_dedupe_list = bun.StringHashMap(void).init(bun.default_allocator);
        try static_routes_dedupe_list.ensureTotalCapacity(@truncate(this.static_routes.items.len));
        defer static_routes_dedupe_list.deinit();

        // Iterate through the list of static routes backwards
        // Later ones added override earlier ones
        var static_routes = this.static_routes;
        this.static_routes = std.ArrayList(StaticRouteEntry).init(bun.default_allocator);
        if (static_routes.items.len > 0) {
            var index = static_routes.items.len - 1;
            while (true) {
                const route = &static_routes.items[index];
                const entry = static_routes_dedupe_list.getOrPut(route.path) catch unreachable;
                if (entry.found_existing) {
                    var item = static_routes.orderedRemove(index);
                    item.deinit();
                }
                if (index == 0) break;
                index -= 1;
            }
        }

        // sort the cloned static routes by name for determinism
        std.mem.sort(StaticRouteEntry, static_routes.items, {}, StaticRouteEntry.isLessThan);

        that.static_routes = static_routes;
        return that;
    }

    pub fn appendStaticRoute(this: *ServerConfig, path: []const u8, route: AnyRoute) !void {
        try this.static_routes.append(StaticRouteEntry{
            .path = try bun.default_allocator.dupe(u8, path),
            .route = route,
        });
    }

    fn applyStaticRoute(server: AnyServer, comptime ssl: bool, app: *uws.NewApp(ssl), comptime T: type, entry: T, path: []const u8) void {
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
        app.any(path, T, entry, handler_wrap.handler);
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
        if (this.sni) |sni| {
            for (sni.slice()) |*ssl_config| {
                ssl_config.deinit();
            }
            this.sni.?.deinitWithAllocator(bun.default_allocator);
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
        var arraylist = std.ArrayList(u8).init(allocator);
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

    pub const SSLConfig = struct {
        requires_custom_request_ctx: bool = false,
        server_name: [*c]const u8 = null,

        key_file_name: [*c]const u8 = null,
        cert_file_name: [*c]const u8 = null,

        ca_file_name: [*c]const u8 = null,
        dh_params_file_name: [*c]const u8 = null,

        passphrase: [*c]const u8 = null,
        low_memory_mode: bool = false,

        key: ?[][*c]const u8 = null,
        key_count: u32 = 0,

        cert: ?[][*c]const u8 = null,
        cert_count: u32 = 0,

        ca: ?[][*c]const u8 = null,
        ca_count: u32 = 0,

        secure_options: u32 = 0,
        request_cert: i32 = 0,
        reject_unauthorized: i32 = 0,
        ssl_ciphers: ?[*:0]const u8 = null,
        protos: ?[*:0]const u8 = null,
        protos_len: usize = 0,
        client_renegotiation_limit: u32 = 0,
        client_renegotiation_window: u32 = 0,

        const log = Output.scoped(.SSLConfig, false);

        pub fn asUSockets(this: SSLConfig) uws.us_bun_socket_context_options_t {
            var ctx_opts: uws.us_bun_socket_context_options_t = .{};

            if (this.key_file_name != null)
                ctx_opts.key_file_name = this.key_file_name;
            if (this.cert_file_name != null)
                ctx_opts.cert_file_name = this.cert_file_name;
            if (this.ca_file_name != null)
                ctx_opts.ca_file_name = this.ca_file_name;
            if (this.dh_params_file_name != null)
                ctx_opts.dh_params_file_name = this.dh_params_file_name;
            if (this.passphrase != null)
                ctx_opts.passphrase = this.passphrase;
            ctx_opts.ssl_prefer_low_memory_usage = @intFromBool(this.low_memory_mode);

            if (this.key) |key| {
                ctx_opts.key = key.ptr;
                ctx_opts.key_count = this.key_count;
            }
            if (this.cert) |cert| {
                ctx_opts.cert = cert.ptr;
                ctx_opts.cert_count = this.cert_count;
            }
            if (this.ca) |ca| {
                ctx_opts.ca = ca.ptr;
                ctx_opts.ca_count = this.ca_count;
            }

            if (this.ssl_ciphers != null) {
                ctx_opts.ssl_ciphers = this.ssl_ciphers;
            }
            ctx_opts.request_cert = this.request_cert;
            ctx_opts.reject_unauthorized = this.reject_unauthorized;

            return ctx_opts;
        }

        pub fn isSame(thisConfig: *const SSLConfig, otherConfig: *const SSLConfig) bool {
            { //strings
                const fields = .{
                    "server_name",
                    "key_file_name",
                    "cert_file_name",
                    "ca_file_name",
                    "dh_params_file_name",
                    "passphrase",
                    "ssl_ciphers",
                    "protos",
                };

                inline for (fields) |field| {
                    const lhs = @field(thisConfig, field);
                    const rhs = @field(otherConfig, field);
                    if (lhs != null and rhs != null) {
                        if (!stringsEqual(lhs, rhs))
                            return false;
                    } else if (lhs != null or rhs != null) {
                        return false;
                    }
                }
            }

            {
                //numbers
                const fields = .{ "secure_options", "request_cert", "reject_unauthorized", "low_memory_mode" };

                inline for (fields) |field| {
                    const lhs = @field(thisConfig, field);
                    const rhs = @field(otherConfig, field);
                    if (lhs != rhs)
                        return false;
                }
            }

            {
                // complex fields
                const fields = .{ "key", "ca", "cert" };
                inline for (fields) |field| {
                    const lhs_count = @field(thisConfig, field ++ "_count");
                    const rhs_count = @field(otherConfig, field ++ "_count");
                    if (lhs_count != rhs_count)
                        return false;
                    if (lhs_count > 0) {
                        const lhs = @field(thisConfig, field);
                        const rhs = @field(otherConfig, field);
                        for (0..lhs_count) |i| {
                            if (!stringsEqual(lhs.?[i], rhs.?[i]))
                                return false;
                        }
                    }
                }
            }

            return true;
        }

        fn stringsEqual(a: [*c]const u8, b: [*c]const u8) bool {
            const lhs = bun.asByteSlice(a);
            const rhs = bun.asByteSlice(b);
            return strings.eqlLong(lhs, rhs, true);
        }

        pub fn deinit(this: *SSLConfig) void {
            const fields = .{
                "server_name",
                "key_file_name",
                "cert_file_name",
                "ca_file_name",
                "dh_params_file_name",
                "passphrase",
                "ssl_ciphers",
                "protos",
            };

            inline for (fields) |field| {
                if (@field(this, field)) |slice_ptr| {
                    const slice = std.mem.span(slice_ptr);
                    if (slice.len > 0) {
                        bun.freeSensitive(bun.default_allocator, slice);
                    }
                    @field(this, field) = "";
                }
            }

            if (this.cert) |cert| {
                for (0..this.cert_count) |i| {
                    const slice = std.mem.span(cert[i]);
                    if (slice.len > 0) {
                        bun.freeSensitive(bun.default_allocator, slice);
                    }
                }

                bun.default_allocator.free(cert);
                this.cert = null;
            }

            if (this.key) |key| {
                for (0..this.key_count) |i| {
                    const slice = std.mem.span(key[i]);
                    if (slice.len > 0) {
                        bun.freeSensitive(bun.default_allocator, slice);
                    }
                }

                bun.default_allocator.free(key);
                this.key = null;
            }

            if (this.ca) |ca| {
                for (0..this.ca_count) |i| {
                    const slice = std.mem.span(ca[i]);
                    if (slice.len > 0) {
                        bun.freeSensitive(bun.default_allocator, slice);
                    }
                }

                bun.default_allocator.free(ca);
                this.ca = null;
            }
        }

        pub const zero = SSLConfig{};

        pub fn fromJS(vm: *JSC.VirtualMachine, global: *JSC.JSGlobalObject, obj: JSC.JSValue) bun.JSError!?SSLConfig {
            var result = zero;
            errdefer result.deinit();

            var arena: bun.ArenaAllocator = bun.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();

            if (!obj.isObject()) {
                return global.throwInvalidArguments("tls option expects an object", .{});
            }

            var any = false;

            result.reject_unauthorized = @intFromBool(vm.getTLSRejectUnauthorized());

            // Required
            if (try obj.getTruthy(global, "keyFile")) |key_file_name| {
                var sliced = try key_file_name.toSlice(global, bun.default_allocator);
                defer sliced.deinit();
                if (sliced.len > 0) {
                    result.key_file_name = try bun.default_allocator.dupeZ(u8, sliced.slice());
                    if (std.posix.system.access(result.key_file_name, std.posix.F_OK) != 0) {
                        return global.throwInvalidArguments("Unable to access keyFile path", .{});
                    }
                    any = true;
                    result.requires_custom_request_ctx = true;
                }
            }

            if (try obj.getTruthy(global, "key")) |js_obj| {
                if (js_obj.jsType().isArray()) {
                    const count = js_obj.getLength(global);
                    if (count > 0) {
                        const native_array = try bun.default_allocator.alloc([*c]const u8, count);

                        var valid_count: u32 = 0;
                        for (0..count) |i| {
                            const item = js_obj.getIndex(global, @intCast(i));
                            if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), item)) |sb| {
                                defer sb.deinit();
                                const sliced = sb.slice();
                                if (sliced.len > 0) {
                                    native_array[valid_count] = try bun.default_allocator.dupeZ(u8, sliced);
                                    valid_count += 1;
                                    any = true;
                                    result.requires_custom_request_ctx = true;
                                }
                            } else if (try BlobFileContentResult.init("key", item, global)) |content| {
                                if (content.data.len > 0) {
                                    native_array[valid_count] = content.data.ptr;
                                    valid_count += 1;
                                    result.requires_custom_request_ctx = true;
                                    any = true;
                                } else {
                                    // mark and free all CA's
                                    result.cert = native_array;
                                    result.deinit();
                                    return null;
                                }
                            } else {
                                // mark and free all keys
                                result.key = native_array;
                                return global.throwInvalidArguments("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                            }
                        }

                        if (valid_count == 0) {
                            bun.default_allocator.free(native_array);
                        } else {
                            result.key = native_array;
                        }

                        result.key_count = valid_count;
                    }
                } else if (try BlobFileContentResult.init("key", js_obj, global)) |content| {
                    if (content.data.len > 0) {
                        const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
                        native_array[0] = content.data.ptr;
                        result.key = native_array;
                        result.key_count = 1;
                        any = true;
                        result.requires_custom_request_ctx = true;
                    } else {
                        result.deinit();
                        return null;
                    }
                } else {
                    const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
                    if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), js_obj)) |sb| {
                        defer sb.deinit();
                        const sliced = sb.slice();
                        if (sliced.len > 0) {
                            native_array[0] = try bun.default_allocator.dupeZ(u8, sliced);
                            any = true;
                            result.requires_custom_request_ctx = true;
                            result.key = native_array;
                            result.key_count = 1;
                        } else {
                            bun.default_allocator.free(native_array);
                        }
                    } else {
                        // mark and free all certs
                        result.key = native_array;
                        return global.throwInvalidArguments("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                    }
                }
            }

            if (try obj.getTruthy(global, "certFile")) |cert_file_name| {
                var sliced = try cert_file_name.toSlice(global, bun.default_allocator);
                defer sliced.deinit();
                if (sliced.len > 0) {
                    result.cert_file_name = try bun.default_allocator.dupeZ(u8, sliced.slice());
                    if (std.posix.system.access(result.cert_file_name, std.posix.F_OK) != 0) {
                        return global.throwInvalidArguments("Unable to access certFile path", .{});
                    }
                    any = true;
                    result.requires_custom_request_ctx = true;
                }
            }

            if (try obj.getTruthy(global, "ALPNProtocols")) |protocols| {
                if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), protocols)) |sb| {
                    defer sb.deinit();
                    const sliced = sb.slice();
                    if (sliced.len > 0) {
                        result.protos = try bun.default_allocator.dupeZ(u8, sliced);
                        result.protos_len = sliced.len;
                    }

                    any = true;
                    result.requires_custom_request_ctx = true;
                } else {
                    return global.throwInvalidArguments("ALPNProtocols argument must be an string, Buffer or TypedArray", .{});
                }
            }

            if (try obj.getTruthy(global, "cert")) |js_obj| {
                if (js_obj.jsType().isArray()) {
                    const count = js_obj.getLength(global);
                    if (count > 0) {
                        const native_array = try bun.default_allocator.alloc([*c]const u8, count);

                        var valid_count: u32 = 0;
                        for (0..count) |i| {
                            const item = js_obj.getIndex(global, @intCast(i));
                            if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), item)) |sb| {
                                defer sb.deinit();
                                const sliced = sb.slice();
                                if (sliced.len > 0) {
                                    native_array[valid_count] = try bun.default_allocator.dupeZ(u8, sliced);
                                    valid_count += 1;
                                    any = true;
                                    result.requires_custom_request_ctx = true;
                                }
                            } else if (try BlobFileContentResult.init("cert", item, global)) |content| {
                                if (content.data.len > 0) {
                                    native_array[valid_count] = content.data.ptr;
                                    valid_count += 1;
                                    result.requires_custom_request_ctx = true;
                                    any = true;
                                } else {
                                    // mark and free all CA's
                                    result.cert = native_array;
                                    result.deinit();
                                    return null;
                                }
                            } else {
                                // mark and free all certs
                                result.cert = native_array;
                                return global.throwInvalidArguments("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                            }
                        }

                        if (valid_count == 0) {
                            bun.default_allocator.free(native_array);
                        } else {
                            result.cert = native_array;
                        }

                        result.cert_count = valid_count;
                    }
                } else if (try BlobFileContentResult.init("cert", js_obj, global)) |content| {
                    if (content.data.len > 0) {
                        const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
                        native_array[0] = content.data.ptr;
                        result.cert = native_array;
                        result.cert_count = 1;
                        any = true;
                        result.requires_custom_request_ctx = true;
                    } else {
                        result.deinit();
                        return null;
                    }
                } else {
                    const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
                    if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), js_obj)) |sb| {
                        defer sb.deinit();
                        const sliced = sb.slice();
                        if (sliced.len > 0) {
                            native_array[0] = try bun.default_allocator.dupeZ(u8, sliced);
                            any = true;
                            result.requires_custom_request_ctx = true;
                            result.cert = native_array;
                            result.cert_count = 1;
                        } else {
                            bun.default_allocator.free(native_array);
                        }
                    } else {
                        // mark and free all certs
                        result.cert = native_array;
                        return global.throwInvalidArguments("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                    }
                }
            }

            if (try obj.getTruthy(global, "requestCert")) |request_cert| {
                if (request_cert.isBoolean()) {
                    result.request_cert = if (request_cert.asBoolean()) 1 else 0;
                    any = true;
                } else {
                    return global.throw("Expected requestCert to be a boolean", .{});
                }
            }

            if (try obj.getTruthy(global, "rejectUnauthorized")) |reject_unauthorized| {
                if (reject_unauthorized.isBoolean()) {
                    result.reject_unauthorized = if (reject_unauthorized.asBoolean()) 1 else 0;
                    any = true;
                } else {
                    return global.throw("Expected rejectUnauthorized to be a boolean", .{});
                }
            }

            if (try obj.getTruthy(global, "ciphers")) |ssl_ciphers| {
                var sliced = try ssl_ciphers.toSlice(global, bun.default_allocator);
                defer sliced.deinit();
                if (sliced.len > 0) {
                    result.ssl_ciphers = try bun.default_allocator.dupeZ(u8, sliced.slice());
                    any = true;
                    result.requires_custom_request_ctx = true;
                }
            }

            if (try obj.getTruthy(global, "serverName") orelse try obj.getTruthy(global, "servername")) |server_name| {
                var sliced = try server_name.toSlice(global, bun.default_allocator);
                defer sliced.deinit();
                if (sliced.len > 0) {
                    result.server_name = try bun.default_allocator.dupeZ(u8, sliced.slice());
                    any = true;
                    result.requires_custom_request_ctx = true;
                }
            }

            if (try obj.getTruthy(global, "ca")) |js_obj| {
                if (js_obj.jsType().isArray()) {
                    const count = js_obj.getLength(global);
                    if (count > 0) {
                        const native_array = try bun.default_allocator.alloc([*c]const u8, count);

                        var valid_count: u32 = 0;
                        for (0..count) |i| {
                            const item = js_obj.getIndex(global, @intCast(i));
                            if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), item)) |sb| {
                                defer sb.deinit();
                                const sliced = sb.slice();
                                if (sliced.len > 0) {
                                    native_array[valid_count] = bun.default_allocator.dupeZ(u8, sliced) catch unreachable;
                                    valid_count += 1;
                                    any = true;
                                    result.requires_custom_request_ctx = true;
                                }
                            } else if (try BlobFileContentResult.init("ca", item, global)) |content| {
                                if (content.data.len > 0) {
                                    native_array[valid_count] = content.data.ptr;
                                    valid_count += 1;
                                    any = true;
                                    result.requires_custom_request_ctx = true;
                                } else {
                                    // mark and free all CA's
                                    result.cert = native_array;
                                    result.deinit();
                                    return null;
                                }
                            } else {
                                // mark and free all CA's
                                result.cert = native_array;
                                return global.throwInvalidArguments("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                            }
                        }

                        if (valid_count == 0) {
                            bun.default_allocator.free(native_array);
                        } else {
                            result.ca = native_array;
                        }

                        result.ca_count = valid_count;
                    }
                } else if (try BlobFileContentResult.init("ca", js_obj, global)) |content| {
                    if (content.data.len > 0) {
                        const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
                        native_array[0] = content.data.ptr;
                        result.ca = native_array;
                        result.ca_count = 1;
                        any = true;
                        result.requires_custom_request_ctx = true;
                    } else {
                        result.deinit();
                        return null;
                    }
                } else {
                    const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
                    if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), js_obj)) |sb| {
                        defer sb.deinit();
                        const sliced = sb.slice();
                        if (sliced.len > 0) {
                            native_array[0] = try bun.default_allocator.dupeZ(u8, sliced);
                            any = true;
                            result.requires_custom_request_ctx = true;
                            result.ca = native_array;
                            result.ca_count = 1;
                        } else {
                            bun.default_allocator.free(native_array);
                        }
                    } else {
                        // mark and free all certs
                        result.ca = native_array;
                        return global.throwInvalidArguments("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                    }
                }
            }

            if (try obj.getTruthy(global, "caFile")) |ca_file_name| {
                var sliced = try ca_file_name.toSlice(global, bun.default_allocator);
                defer sliced.deinit();
                if (sliced.len > 0) {
                    result.ca_file_name = try bun.default_allocator.dupeZ(u8, sliced.slice());
                    if (std.posix.system.access(result.ca_file_name, std.posix.F_OK) != 0) {
                        return global.throwInvalidArguments("Invalid caFile path", .{});
                    }
                }
            }
            // Optional
            if (any) {
                if (try obj.getTruthy(global, "secureOptions")) |secure_options| {
                    if (secure_options.isNumber()) {
                        result.secure_options = secure_options.toU32();
                    }
                }

                if (try obj.getTruthy(global, "clientRenegotiationLimit")) |client_renegotiation_limit| {
                    if (client_renegotiation_limit.isNumber()) {
                        result.client_renegotiation_limit = client_renegotiation_limit.toU32();
                    }
                }

                if (try obj.getTruthy(global, "clientRenegotiationWindow")) |client_renegotiation_window| {
                    if (client_renegotiation_window.isNumber()) {
                        result.client_renegotiation_window = client_renegotiation_window.toU32();
                    }
                }

                if (try obj.getTruthy(global, "dhParamsFile")) |dh_params_file_name| {
                    var sliced = try dh_params_file_name.toSlice(global, bun.default_allocator);
                    defer sliced.deinit();
                    if (sliced.len > 0) {
                        result.dh_params_file_name = try bun.default_allocator.dupeZ(u8, sliced.slice());
                        if (std.posix.system.access(result.dh_params_file_name, std.posix.F_OK) != 0) {
                            return global.throwInvalidArguments("Invalid dhParamsFile path", .{});
                        }
                    }
                }

                if (try obj.getTruthy(global, "passphrase")) |passphrase| {
                    var sliced = try passphrase.toSlice(global, bun.default_allocator);
                    defer sliced.deinit();
                    if (sliced.len > 0) {
                        result.passphrase = try bun.default_allocator.dupeZ(u8, sliced.slice());
                    }
                }

                if (try obj.get(global, "lowMemoryMode")) |low_memory_mode| {
                    if (low_memory_mode.isBoolean() or low_memory_mode.isUndefined()) {
                        result.low_memory_mode = low_memory_mode.toBoolean();
                        any = true;
                    } else {
                        return global.throw("Expected lowMemoryMode to be a boolean", .{});
                    }
                }
            }

            if (!any)
                return null;
            return result;
        }
    };

    fn getRoutesObject(global: *JSC.JSGlobalObject, arg: JSC.JSValue) bun.JSError!?JSC.JSValue {
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
        global: *JSC.JSGlobalObject,
        args: *ServerConfig,
        arguments: *JSC.Node.ArgumentsSlice,
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
                        \\Learn more at https://bun.sh/docs/api/http
                    , .{});
                };
                args.had_routes_object = true;

                var iter = try JSC.JSPropertyIterator(.{
                    .skip_empty_name = true,
                    .include_value = true,
                }).init(global, static_obj);
                defer iter.deinit();

                var init_ctx: ServerInitContext = .{
                    .arena = .init(bun.default_allocator),
                    .dedupe_html_bundle_map = .init(bun.default_allocator),
                    .framework_router_list = .init(bun.default_allocator),
                    .js_string_allocations = .empty,
                };
                errdefer {
                    init_ctx.arena.deinit();
                    init_ctx.framework_router_list.deinit();
                }
                // This list is not used in the success case
                defer init_ctx.dedupe_html_bundle_map.deinit();

                var framework_router_list = std.ArrayList(bun.bake.FrameworkRouter.Type).init(bun.default_allocator);
                errdefer framework_router_list.deinit();

                errdefer {
                    for (args.static_routes.items) |*static_route| {
                        static_route.deinit();
                    }
                    args.static_routes.clearAndFree();
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

                    if (value == .false) {
                        const duped = bun.default_allocator.dupeZ(u8, path) catch bun.outOfMemory();
                        defer bun.default_allocator.free(path);
                        args.negative_routes.append(duped) catch bun.outOfMemory();
                        continue;
                    }

                    if (value.isCallable()) {
                        try validateRouteName(global, path);
                        args.user_routes_to_build.append(.{
                            .route = .{
                                .path = bun.default_allocator.dupeZ(u8, path) catch bun.outOfMemory(),
                                .method = .any,
                            },
                            .callback = JSC.Strong.create(value.withAsyncContextIfNeeded(global), global),
                        }) catch bun.outOfMemory();
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
                            if (value.getOwn(global, @tagName(method))) |function| {
                                if (!function.isCallable()) {
                                    return global.throwInvalidArguments("Expected {s} in {} route to be a function", .{ @tagName(method), bun.fmt.quote(path) });
                                }
                                if (!found) {
                                    try validateRouteName(global, path);
                                }
                                found = true;
                                args.user_routes_to_build.append(.{
                                    .route = .{
                                        .path = bun.default_allocator.dupeZ(u8, path) catch bun.outOfMemory(),
                                        .method = .{ .specific = method },
                                    },
                                    .callback = JSC.Strong.create(function.withAsyncContextIfNeeded(global), global),
                                }) catch bun.outOfMemory();
                            }
                        }

                        if (found) {
                            bun.default_allocator.free(path);
                            continue;
                        }
                    }

                    const route = try AnyRoute.fromJS(global, path, value, &init_ctx);
                    args.static_routes.append(.{
                        .path = path,
                        .route = route,
                    }) catch bun.outOfMemory();
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
                args.websocket = try WebSocketServer.onCreate(global, websocket_object);
            }
            if (global.hasException()) return error.JSError;

            if (try arg.getTruthy(global, "port")) |port_| {
                args.address.tcp.port = @as(
                    u16,
                    @intCast(@min(
                        @max(0, port_.coerce(i32, global)),
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
                    const id_str = try id.toSlice(
                        global,
                        bun.default_allocator,
                    );

                    if (id_str.len > 0) {
                        args.id = (id_str.cloneIfNeeded(bun.default_allocator) catch unreachable).slice();
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
                args.reuse_port = dev.coerce(bool, global);
            }
            if (global.hasException()) return error.JSError;

            if (try arg.get(global, "ipv6Only")) |dev| {
                args.ipv6_only = dev.coerce(bool, global);
            }
            if (global.hasException()) return error.JSError;

            if (try arg.get(global, "inspector")) |inspector| {
                args.inspector = inspector.coerce(bool, global);

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
                JSC.C.JSValueProtect(global, onRequest.asObjectRef());
                args.onNodeHTTPRequest = onRequest;
            }

            if (try arg.getTruthy(global, "fetch")) |onRequest_| {
                if (!onRequest_.isCallable()) {
                    return global.throwInvalidArguments("Expected fetch() to be a function", .{});
                }
                const onRequest = onRequest_.withAsyncContextIfNeeded(global);
                JSC.C.JSValueProtect(global, onRequest.asObjectRef());
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
                    \\Learn more at https://bun.sh/docs/api/http
                , .{});
            } else {
                if (global.hasException()) return error.JSError;
            }

            if (try arg.getTruthy(global, "tls")) |tls| {
                if (tls.isFalsey()) {
                    args.ssl_config = null;
                } else if (tls.jsType().isArray()) {
                    var value_iter = tls.arrayIterator(global);
                    if (value_iter.len == 1) {
                        return global.throwInvalidArguments("tls option expects at least 1 tls object", .{});
                    }
                    while (value_iter.next()) |item| {
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
                            if (ssl_config.server_name == null or std.mem.span(ssl_config.server_name).len == 0) {
                                defer ssl_config.deinit();
                                return global.throwInvalidArguments("SNI tls object must have a serverName", .{});
                            }
                            if (args.sni == null) {
                                args.sni = bun.BabyList(SSLConfig).initCapacity(bun.default_allocator, value_iter.len - 1) catch bun.outOfMemory();
                            }

                            args.sni.?.push(bun.default_allocator, ssl_config) catch bun.outOfMemory();
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
};

pub const HTTPStatusText = struct {
    pub fn get(code: u16) ?[]const u8 {
        return switch (code) {
            100 => "100 Continue",
            101 => "101 Switching protocols",
            102 => "102 Processing",
            103 => "103 Early Hints",
            200 => "200 OK",
            201 => "201 Created",
            202 => "202 Accepted",
            203 => "203 Non-Authoritative Information",
            204 => "204 No Content",
            205 => "205 Reset Content",
            206 => "206 Partial Content",
            207 => "207 Multi-Status",
            208 => "208 Already Reported",
            226 => "226 IM Used",
            300 => "300 Multiple Choices",
            301 => "301 Moved Permanently",
            302 => "302 Found",
            303 => "303 See Other",
            304 => "304 Not Modified",
            305 => "305 Use Proxy",
            306 => "306 Switch Proxy",
            307 => "307 Temporary Redirect",
            308 => "308 Permanent Redirect",
            400 => "400 Bad Request",
            401 => "401 Unauthorized",
            402 => "402 Payment Required",
            403 => "403 Forbidden",
            404 => "404 Not Found",
            405 => "405 Method Not Allowed",
            406 => "406 Not Acceptable",
            407 => "407 Proxy Authentication Required",
            408 => "408 Request Timeout",
            409 => "409 Conflict",
            410 => "410 Gone",
            411 => "411 Length Required",
            412 => "412 Precondition Failed",
            413 => "413 Payload Too Large",
            414 => "414 URI Too Long",
            415 => "415 Unsupported Media Type",
            416 => "416 Range Not Satisfiable",
            417 => "417 Expectation Failed",
            418 => "418 I'm a Teapot",
            421 => "421 Misdirected Request",
            422 => "422 Unprocessable Entity",
            423 => "423 Locked",
            424 => "424 Failed Dependency",
            425 => "425 Too Early",
            426 => "426 Upgrade Required",
            428 => "428 Precondition Required",
            429 => "429 Too Many Requests",
            431 => "431 Request Header Fields Too Large",
            451 => "451 Unavailable For Legal Reasons",
            500 => "500 Internal Server Error",
            501 => "501 Not Implemented",
            502 => "502 Bad Gateway",
            503 => "503 Service Unavailable",
            504 => "504 Gateway Timeout",
            505 => "505 HTTP Version Not Supported",
            506 => "506 Variant Also Negotiates",
            507 => "507 Insufficient Storage",
            508 => "508 Loop Detected",
            510 => "510 Not Extended",
            511 => "511 Network Authentication Required",
            else => null,
        };
    }
};

fn NewFlags(comptime debug_mode: bool) type {
    return packed struct {
        has_marked_complete: bool = false,
        has_marked_pending: bool = false,
        has_abort_handler: bool = false,
        has_timeout_handler: bool = false,
        has_sendfile_ctx: bool = false,
        has_called_error_handler: bool = false,
        needs_content_length: bool = false,
        needs_content_range: bool = false,
        /// Used to avoid looking at the uws.Request struct after it's been freed
        is_transfer_encoding: bool = false,

        /// Used to identify if request can be safely deinitialized
        is_waiting_for_request_body: bool = false,
        /// Used in renderMissing in debug mode to show the user an HTML page
        /// Used to avoid looking at the uws.Request struct after it's been freed
        is_web_browser_navigation: if (debug_mode) bool else void = if (debug_mode) false,
        has_written_status: bool = false,
        response_protected: bool = false,
        aborted: bool = false,
        has_finalized: bun.DebugOnly(bool) = bun.DebugOnlyDefault(false),

        is_error_promise_pending: bool = false,
    };
}

/// A generic wrapper for the HTTP(s) Server`RequestContext`s.
/// Only really exists because of `NewServer()` and `NewRequestContext()` generics.
pub const AnyRequestContext = struct {
    pub const Pointer = bun.TaggedPointerUnion(.{
        HTTPServer.RequestContext,
        HTTPSServer.RequestContext,
        DebugHTTPServer.RequestContext,
        DebugHTTPSServer.RequestContext,
    });

    tagged_pointer: Pointer,

    pub const Null: @This() = .{ .tagged_pointer = Pointer.Null };

    pub fn init(request_ctx: anytype) AnyRequestContext {
        return .{ .tagged_pointer = Pointer.init(request_ctx) };
    }

    pub fn memoryCost(self: AnyRequestContext) usize {
        if (self.tagged_pointer.isNull()) {
            return 0;
        }

        switch (self.tagged_pointer.tag()) {
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPServer.RequestContext).memoryCost();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPSServer.RequestContext).memoryCost();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPServer.RequestContext).memoryCost();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).memoryCost();
            },
            else => @panic("Unexpected AnyRequestContext tag"),
        }
    }

    pub fn get(self: AnyRequestContext, comptime T: type) ?*T {
        return self.tagged_pointer.get(T);
    }

    pub fn setTimeout(self: AnyRequestContext, seconds: c_uint) bool {
        if (self.tagged_pointer.isNull()) {
            return false;
        }

        switch (self.tagged_pointer.tag()) {
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPServer.RequestContext).setTimeout(seconds);
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPSServer.RequestContext).setTimeout(seconds);
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPServer.RequestContext).setTimeout(seconds);
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).setTimeout(seconds);
            },
            else => @panic("Unexpected AnyRequestContext tag"),
        }
        return false;
    }

    pub fn setCookies(self: AnyRequestContext, cookie_map: ?*JSC.WebCore.CookieMap) void {
        if (self.tagged_pointer.isNull()) {
            return;
        }

        switch (self.tagged_pointer.tag()) {
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPServer.RequestContext).setCookies(cookie_map);
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPSServer.RequestContext).setCookies(cookie_map);
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPServer.RequestContext).setCookies(cookie_map);
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).setCookies(cookie_map);
            },
            else => @panic("Unexpected AnyRequestContext tag"),
        }
    }

    pub fn enableTimeoutEvents(self: AnyRequestContext) void {
        if (self.tagged_pointer.isNull()) {
            return;
        }

        switch (self.tagged_pointer.tag()) {
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPServer.RequestContext).setTimeoutHandler();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPSServer.RequestContext).setTimeoutHandler();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPServer.RequestContext).setTimeoutHandler();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).setTimeoutHandler();
            },
            else => @panic("Unexpected AnyRequestContext tag"),
        }
    }

    pub fn getRemoteSocketInfo(self: AnyRequestContext) ?uws.SocketAddress {
        if (self.tagged_pointer.isNull()) {
            return null;
        }

        switch (self.tagged_pointer.tag()) {
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPServer.RequestContext).getRemoteSocketInfo();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPSServer.RequestContext).getRemoteSocketInfo();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPServer.RequestContext).getRemoteSocketInfo();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).getRemoteSocketInfo();
            },
            else => @panic("Unexpected AnyRequestContext tag"),
        }
    }

    pub fn detachRequest(self: AnyRequestContext) void {
        if (self.tagged_pointer.isNull()) {
            return;
        }
        switch (self.tagged_pointer.tag()) {
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
                self.tagged_pointer.as(HTTPServer.RequestContext).req = null;
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
                self.tagged_pointer.as(HTTPSServer.RequestContext).req = null;
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
                self.tagged_pointer.as(DebugHTTPServer.RequestContext).req = null;
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
                self.tagged_pointer.as(DebugHTTPSServer.RequestContext).req = null;
            },
            else => @panic("Unexpected AnyRequestContext tag"),
        }
    }

    /// Wont actually set anything if `self` is `.none`
    pub fn setRequest(self: AnyRequestContext, req: *uws.Request) void {
        if (self.tagged_pointer.isNull()) {
            return;
        }

        switch (self.tagged_pointer.tag()) {
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
                self.tagged_pointer.as(HTTPServer.RequestContext).req = req;
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
                self.tagged_pointer.as(HTTPSServer.RequestContext).req = req;
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
                self.tagged_pointer.as(DebugHTTPServer.RequestContext).req = req;
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
                self.tagged_pointer.as(DebugHTTPSServer.RequestContext).req = req;
            },
            else => @panic("Unexpected AnyRequestContext tag"),
        }
    }

    pub fn getRequest(self: AnyRequestContext) ?*uws.Request {
        if (self.tagged_pointer.isNull()) {
            return null;
        }

        switch (self.tagged_pointer.tag()) {
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPServer.RequestContext).req;
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(HTTPSServer.RequestContext).req;
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPServer.RequestContext).req;
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
                return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).req;
            },
            else => @panic("Unexpected AnyRequestContext tag"),
        }
    }

    pub fn deref(self: AnyRequestContext) void {
        if (self.tagged_pointer.isNull()) {
            return;
        }

        switch (self.tagged_pointer.tag()) {
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
                self.tagged_pointer.as(HTTPServer.RequestContext).deref();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
                self.tagged_pointer.as(HTTPSServer.RequestContext).deref();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
                self.tagged_pointer.as(DebugHTTPServer.RequestContext).deref();
            },
            @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
                self.tagged_pointer.as(DebugHTTPSServer.RequestContext).deref();
            },
            else => @panic("Unexpected AnyRequestContext tag"),
        }
    }
};

// This is defined separately partially to work-around an LLVM debugger bug.
fn NewRequestContext(comptime ssl_enabled: bool, comptime debug_mode: bool, comptime ThisServer: type) type {
    return struct {
        const RequestContext = @This();

        const App = uws.NewApp(ssl_enabled);
        pub threadlocal var pool: ?*RequestContext.RequestContextStackAllocator = null;
        pub const ResponseStream = JSC.WebCore.HTTPServerWritable(ssl_enabled);

        // This pre-allocates up to 2,048 RequestContext structs.
        // It costs about 655,632 bytes.
        pub const RequestContextStackAllocator = bun.HiveArray(RequestContext, if (bun.heap_breakdown.enabled) 0 else 2048).Fallback;

        server: ?*ThisServer,
        resp: ?*App.Response,
        /// thread-local default heap allocator
        /// this prevents an extra pthread_getspecific() call which shows up in profiling
        allocator: std.mem.Allocator,
        req: ?*uws.Request,
        request_weakref: Request.WeakRef = .{},
        signal: ?*JSC.WebCore.AbortSignal = null,
        method: HTTP.Method,
        cookies: ?*JSC.WebCore.CookieMap = null,

        flags: NewFlags(debug_mode) = .{},

        upgrade_context: ?*uws.uws_socket_context_t = null,

        /// We can only safely free once the request body promise is finalized
        /// and the response is rejected
        response_jsvalue: JSC.JSValue = JSC.JSValue.zero,
        ref_count: u8 = 1,

        response_ptr: ?*JSC.WebCore.Response = null,
        blob: JSC.WebCore.AnyBlob = JSC.WebCore.AnyBlob{ .Blob = .{} },

        sendfile: SendfileContext = undefined,

        request_body_readable_stream_ref: JSC.WebCore.ReadableStream.Strong = .{},
        request_body: ?*JSC.BodyValueRef = null,
        request_body_buf: std.ArrayListUnmanaged(u8) = .{},
        request_body_content_len: usize = 0,

        sink: ?*ResponseStream.JSSink = null,
        byte_stream: ?*JSC.WebCore.ByteStream = null,
        // reference to the readable stream / byte_stream alive
        readable_stream_ref: JSC.WebCore.ReadableStream.Strong = .{},

        /// Used in errors
        pathname: bun.String = bun.String.empty,

        /// Used either for temporary blob data or fallback
        /// When the response body is a temporary value
        response_buf_owned: std.ArrayListUnmanaged(u8) = .{},

        /// Defer finalization until after the request handler task is completed?
        defer_deinit_until_callback_completes: ?*bool = null,

        // TODO: support builtin compression
        const can_sendfile = !ssl_enabled and !Environment.isWindows;

        pub fn memoryCost(this: *const RequestContext) usize {
            // The Sink and ByteStream aren't owned by this.
            return @sizeOf(RequestContext) + this.request_body_buf.capacity + this.response_buf_owned.capacity + this.blob.memoryCost();
        }

        pub inline fn isAsync(this: *const RequestContext) bool {
            return this.defer_deinit_until_callback_completes == null;
        }

        fn drainMicrotasks(this: *const RequestContext) void {
            if (this.isAsync()) return;
            if (this.server) |server| server.vm.drainMicrotasks();
        }

        pub fn setAbortHandler(this: *RequestContext) void {
            if (this.flags.has_abort_handler) return;
            if (this.resp) |resp| {
                this.flags.has_abort_handler = true;
                resp.onAborted(*RequestContext, RequestContext.onAbort, this);
            }
        }

        pub fn setCookies(this: *RequestContext, cookie_map: ?*JSC.WebCore.CookieMap) void {
            if (this.cookies) |cookies| cookies.deref();
            this.cookies = cookie_map;
            if (this.cookies) |cookies| cookies.ref();
        }

        pub fn setTimeoutHandler(this: *RequestContext) void {
            if (this.flags.has_timeout_handler) return;
            if (this.resp) |resp| {
                this.flags.has_timeout_handler = true;
                resp.onTimeout(*RequestContext, RequestContext.onTimeout, this);
            }
        }

        pub fn onResolve(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            ctxLog("onResolve", .{});

            const arguments = callframe.arguments_old(2);
            var ctx = arguments.ptr[1].asPromisePtr(@This());
            defer ctx.deref();

            const result = arguments.ptr[0];
            result.ensureStillAlive();

            handleResolve(ctx, result);
            return JSValue.jsUndefined();
        }

        fn renderMissingInvalidResponse(ctx: *RequestContext, value: JSC.JSValue) void {
            const class_name = value.getClassInfoName() orelse "";

            if (ctx.server) |server| {
                const globalThis: *JSC.JSGlobalObject = server.globalThis;

                Output.enableBuffering();
                var writer = Output.errorWriter();

                if (bun.strings.eqlComptime(class_name, "Response")) {
                    Output.errGeneric("Expected a native Response object, but received a polyfilled Response object. Bun.serve() only supports native Response objects.", .{});
                } else if (value != .zero and !globalThis.hasException()) {
                    var formatter = JSC.ConsoleObject.Formatter{
                        .globalThis = globalThis,
                        .quote_strings = true,
                    };
                    defer formatter.deinit();
                    Output.errGeneric("Expected a Response object, but received '{}'", .{value.toFmt(&formatter)});
                } else {
                    Output.errGeneric("Expected a Response object", .{});
                }

                Output.flush();
                if (!globalThis.hasException()) {
                    JSC.ConsoleObject.writeTrace(@TypeOf(&writer), &writer, globalThis);
                }
                Output.flush();
            }
            ctx.renderMissing();
        }

        fn handleResolve(ctx: *RequestContext, value: JSC.JSValue) void {
            if (ctx.isAbortedOrEnded() or ctx.didUpgradeWebSocket()) {
                return;
            }

            if (ctx.server == null) {
                ctx.renderMissingInvalidResponse(value);
                return;
            }
            if (value.isEmptyOrUndefinedOrNull() or !value.isCell()) {
                ctx.renderMissingInvalidResponse(value);
                return;
            }

            const response = value.as(JSC.WebCore.Response) orelse {
                ctx.renderMissingInvalidResponse(value);
                return;
            };
            ctx.response_jsvalue = value;
            assert(!ctx.flags.response_protected);
            ctx.flags.response_protected = true;
            JSC.C.JSValueProtect(ctx.server.?.globalThis, value.asObjectRef());

            if (ctx.method == .HEAD) {
                if (ctx.resp) |resp| {
                    var pair = HeaderResponsePair{ .this = ctx, .response = response };
                    resp.runCorkedWithType(*HeaderResponsePair, doRenderHeadResponse, &pair);
                }
                return;
            }

            ctx.render(response);
        }

        pub fn shouldRenderMissing(this: *RequestContext) bool {
            // If we did not respond yet, we should render missing
            // To allow this all the conditions above should be true:
            // 1 - still has a response (not detached)
            // 2 - not aborted
            // 3 - not marked completed
            // 4 - not marked pending
            // 5 - is the only reference of the context
            // 6 - is not waiting for request body
            // 7 - did not call sendfile
            return this.resp != null and !this.flags.aborted and !this.flags.has_marked_complete and !this.flags.has_marked_pending and this.ref_count == 1 and !this.flags.is_waiting_for_request_body and !this.flags.has_sendfile_ctx;
        }

        pub fn isDeadRequest(this: *RequestContext) bool {
            // check if has pending promise or extra reference (aka not the only reference)
            if (this.ref_count > 1) return false;
            // check if the body is Locked (streaming)
            if (this.request_body) |body| {
                if (body.value == .Locked) {
                    return false;
                }
            }

            return true;
        }

        /// destroy RequestContext, should be only called by deref or if defer_deinit_until_callback_completes is ref is set to true
        fn deinit(this: *RequestContext) void {
            this.detachResponse();
            this.endRequestStreamingAndDrain();
            // TODO: has_marked_complete is doing something?
            this.flags.has_marked_complete = true;

            if (this.defer_deinit_until_callback_completes) |defer_deinit| {
                defer_deinit.* = true;
                ctxLog("deferred deinit <d> ({*})<r>", .{this});
                return;
            }

            ctxLog("deinit<d> ({*})<r>", .{this});
            if (comptime Environment.allow_assert)
                assert(this.flags.has_finalized);

            this.request_body_buf.clearAndFree(this.allocator);
            this.response_buf_owned.clearAndFree(this.allocator);

            if (this.request_body) |body| {
                _ = body.unref();
                this.request_body = null;
            }

            if (this.server) |server| {
                this.server = null;
                server.request_pool_allocator.put(this);
                server.onRequestComplete();
            }
        }

        pub fn deref(this: *RequestContext) void {
            streamLog("deref", .{});
            assert(this.ref_count > 0);
            const ref_count = this.ref_count;
            this.ref_count -= 1;
            if (ref_count == 1) {
                this.finalizeWithoutDeinit();
                this.deinit();
            }
        }

        pub fn ref(this: *RequestContext) void {
            streamLog("ref", .{});
            this.ref_count += 1;
        }

        pub fn onReject(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            ctxLog("onReject", .{});

            const arguments = callframe.arguments_old(2);
            const ctx = arguments.ptr[1].asPromisePtr(@This());
            const err = arguments.ptr[0];
            defer ctx.deref();
            handleReject(ctx, if (!err.isEmptyOrUndefinedOrNull()) err else .undefined);
            return JSValue.jsUndefined();
        }

        fn handleReject(ctx: *RequestContext, value: JSC.JSValue) void {
            if (ctx.isAbortedOrEnded()) {
                return;
            }

            const resp = ctx.resp.?;
            const has_responded = resp.hasResponded();
            if (!has_responded) {
                const original_state = ctx.defer_deinit_until_callback_completes;
                var should_deinit_context = if (original_state) |defer_deinit| defer_deinit.* else false;
                ctx.defer_deinit_until_callback_completes = &should_deinit_context;
                ctx.runErrorHandler(
                    value,
                );
                ctx.defer_deinit_until_callback_completes = original_state;
                // we try to deinit inside runErrorHandler so we just return here and let it deinit
                if (should_deinit_context) {
                    ctx.deinit();
                    return;
                }
            }
            // check again in case it get aborted after runErrorHandler
            if (ctx.isAbortedOrEnded()) {
                return;
            }

            // I don't think this case happens?
            if (ctx.didUpgradeWebSocket()) {
                return;
            }

            if (!resp.hasResponded() and !ctx.flags.has_marked_pending and !ctx.flags.is_error_promise_pending) {
                ctx.renderMissing();
                return;
            }
        }

        pub fn renderMissing(ctx: *RequestContext) void {
            if (ctx.resp) |resp| {
                resp.runCorkedWithType(*RequestContext, renderMissingCorked, ctx);
            }
        }

        pub fn renderMissingCorked(ctx: *RequestContext) void {
            if (ctx.resp) |resp| {
                if (comptime !debug_mode) {
                    if (!ctx.flags.has_written_status)
                        resp.writeStatus("204 No Content");
                    ctx.flags.has_written_status = true;
                    ctx.end("", ctx.shouldCloseConnection());
                    return;
                }
                // avoid writing the status again and mismatching the content-length
                if (ctx.flags.has_written_status) {
                    ctx.end("", ctx.shouldCloseConnection());
                    return;
                }

                if (ctx.flags.is_web_browser_navigation) {
                    resp.writeStatus("200 OK");
                    ctx.flags.has_written_status = true;

                    resp.writeHeader("content-type", MimeType.html.value);
                    resp.writeHeader("content-encoding", "gzip");
                    resp.writeHeaderInt("content-length", welcome_page_html_gz.len);
                    ctx.end(welcome_page_html_gz, ctx.shouldCloseConnection());
                    return;
                }
                const missing_content = "Welcome to Bun! To get started, return a Response object.";
                resp.writeStatus("200 OK");
                resp.writeHeader("content-type", MimeType.text.value);
                resp.writeHeaderInt("content-length", missing_content.len);
                ctx.flags.has_written_status = true;
                ctx.end(missing_content, ctx.shouldCloseConnection());
            }
        }

        pub fn renderDefaultError(
            this: *RequestContext,
            log: *logger.Log,
            err: anyerror,
            exceptions: []Api.JsException,
            comptime fmt: string,
            args: anytype,
        ) void {
            if (!this.flags.has_written_status) {
                this.flags.has_written_status = true;
                if (this.resp) |resp| {
                    resp.writeStatus("500 Internal Server Error");
                    resp.writeHeader("content-type", MimeType.html.value);
                }
            }

            const allocator = this.allocator;

            const fallback_container = allocator.create(Api.FallbackMessageContainer) catch unreachable;
            defer allocator.destroy(fallback_container);
            fallback_container.* = Api.FallbackMessageContainer{
                .message = std.fmt.allocPrint(allocator, comptime Output.prettyFmt(fmt, false), args) catch unreachable,
                .router = null,
                .reason = .fetch_event_handler,
                .cwd = VirtualMachine.get().transpiler.fs.top_level_dir,
                .problems = Api.Problems{
                    .code = @as(u16, @truncate(@intFromError(err))),
                    .name = @errorName(err),
                    .exceptions = exceptions,
                    .build = log.toAPI(allocator) catch unreachable,
                },
            };

            if (comptime fmt.len > 0) Output.prettyErrorln(fmt, args);
            Output.flush();

            var bb = std.ArrayList(u8).init(allocator);
            const bb_writer = bb.writer();

            Fallback.renderBackend(
                allocator,
                fallback_container,
                @TypeOf(bb_writer),
                bb_writer,
            ) catch unreachable;
            if (this.resp == null or this.resp.?.tryEnd(bb.items, bb.items.len, this.shouldCloseConnection())) {
                bb.clearAndFree();
                this.detachResponse();
                this.endRequestStreamingAndDrain();
                this.finalizeWithoutDeinit();
                this.deref();
                return;
            }

            this.flags.has_marked_pending = true;
            this.response_buf_owned = std.ArrayListUnmanaged(u8){ .items = bb.items, .capacity = bb.capacity };

            if (this.resp) |resp| {
                resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
            }
        }

        pub fn renderResponseBuffer(this: *RequestContext) void {
            if (this.resp) |resp| {
                resp.onWritable(*RequestContext, onWritableResponseBuffer, this);
            }
        }

        /// Render a complete response buffer
        pub fn renderResponseBufferAndMetadata(this: *RequestContext) void {
            if (this.resp) |resp| {
                this.renderMetadata();

                if (!resp.tryEnd(
                    this.response_buf_owned.items,
                    this.response_buf_owned.items.len,
                    this.shouldCloseConnection(),
                )) {
                    this.flags.has_marked_pending = true;
                    resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
                    return;
                }
            }
            this.detachResponse();
            this.endRequestStreamingAndDrain();
            this.deref();
        }

        /// Drain a partial response buffer
        pub fn drainResponseBufferAndMetadata(this: *RequestContext) void {
            if (this.resp) |resp| {
                this.renderMetadata();

                _ = resp.write(
                    this.response_buf_owned.items,
                );
            }
            this.response_buf_owned.items.len = 0;
        }

        pub fn end(this: *RequestContext, data: []const u8, closeConnection: bool) void {
            if (this.resp) |resp| {
                defer this.deref();

                this.detachResponse();
                this.endRequestStreamingAndDrain();
                resp.end(data, closeConnection);
            }
        }

        pub fn endStream(this: *RequestContext, closeConnection: bool) void {
            ctxLog("endStream", .{});
            if (this.resp) |resp| {
                defer this.deref();

                this.detachResponse();
                this.endRequestStreamingAndDrain();
                // This will send a terminating 0\r\n\r\n chunk to the client
                // We only want to do that if they're still expecting a body
                // We cannot call this function if the Content-Length header was previously set
                if (resp.state().isResponsePending())
                    resp.endStream(closeConnection);
            }
        }

        pub fn endWithoutBody(this: *RequestContext, closeConnection: bool) void {
            if (this.resp) |resp| {
                defer this.deref();

                this.detachResponse();
                this.endRequestStreamingAndDrain();
                resp.endWithoutBody(closeConnection);
            }
        }

        pub fn onWritableResponseBuffer(this: *RequestContext, _: u64, resp: *App.Response) bool {
            ctxLog("onWritableResponseBuffer", .{});

            assert(this.resp == resp);
            if (this.isAbortedOrEnded()) {
                return false;
            }
            this.end("", this.shouldCloseConnection());
            return false;
        }

        // TODO: should we cork?
        pub fn onWritableCompleteResponseBufferAndMetadata(this: *RequestContext, write_offset: u64, resp: *App.Response) bool {
            ctxLog("onWritableCompleteResponseBufferAndMetadata", .{});
            assert(this.resp == resp);

            if (this.isAbortedOrEnded()) {
                return false;
            }

            if (!this.flags.has_written_status) {
                this.renderMetadata();
            }

            if (this.method == .HEAD) {
                this.endWithoutBody(this.shouldCloseConnection());
                return false;
            }

            return this.sendWritableBytesForCompleteResponseBuffer(this.response_buf_owned.items, write_offset, resp);
        }

        pub fn onWritableCompleteResponseBuffer(this: *RequestContext, write_offset: u64, resp: *App.Response) bool {
            ctxLog("onWritableCompleteResponseBuffer", .{});
            assert(this.resp == resp);
            if (this.isAbortedOrEnded()) {
                return false;
            }
            return this.sendWritableBytesForCompleteResponseBuffer(this.response_buf_owned.items, write_offset, resp);
        }

        pub fn create(this: *RequestContext, server: *ThisServer, req: *uws.Request, resp: *App.Response, should_deinit_context: ?*bool) void {
            this.* = .{
                .allocator = server.allocator,
                .resp = resp,
                .req = req,
                .method = HTTP.Method.which(req.method()) orelse .GET,
                .server = server,
                .defer_deinit_until_callback_completes = should_deinit_context,
            };

            ctxLog("create<d> ({*})<r>", .{this});
        }

        pub fn onTimeout(this: *RequestContext, resp: *App.Response) void {
            assert(this.resp == resp);
            assert(this.server != null);

            var any_js_calls = false;
            var vm = this.server.?.vm;
            const globalThis = this.server.?.globalThis;
            defer {
                // This is a task in the event loop.
                // If we called into JavaScript, we must drain the microtask queue
                if (any_js_calls) {
                    vm.drainMicrotasks();
                }
            }

            if (this.request_weakref.get()) |request| {
                if (request.internal_event_callback.trigger(Request.InternalJSEventCallback.EventType.timeout, globalThis)) {
                    any_js_calls = true;
                }
            }
        }

        pub fn onAbort(this: *RequestContext, resp: *App.Response) void {
            assert(this.resp == resp);
            assert(!this.flags.aborted);
            assert(this.server != null);
            // mark request as aborted
            this.flags.aborted = true;

            this.detachResponse();
            var any_js_calls = false;
            var vm = this.server.?.vm;
            const globalThis = this.server.?.globalThis;
            defer {
                // This is a task in the event loop.
                // If we called into JavaScript, we must drain the microtask queue
                if (any_js_calls) {
                    vm.drainMicrotasks();
                }
                this.deref();
            }

            if (this.request_weakref.get()) |request| {
                request.request_context = AnyRequestContext.Null;
                if (request.internal_event_callback.trigger(Request.InternalJSEventCallback.EventType.abort, globalThis)) {
                    any_js_calls = true;
                }
                // we can already clean this strong refs
                request.internal_event_callback.deinit();
                this.request_weakref.deinit();
            }
            // if signal is not aborted, abort the signal
            if (this.signal) |signal| {
                this.signal = null;
                defer {
                    signal.pendingActivityUnref();
                    signal.unref();
                }
                if (!signal.aborted()) {
                    signal.signal(globalThis, .ConnectionClosed);
                    any_js_calls = true;
                }
            }

            //if have sink, call onAborted on sink
            if (this.sink) |wrapper| {
                wrapper.sink.abort();
                return;
            }

            // if we can, free the request now.
            if (this.isDeadRequest()) {
                this.finalizeWithoutDeinit();
            } else {
                if (this.endRequestStreaming()) {
                    any_js_calls = true;
                }

                if (this.response_ptr) |response| {
                    if (response.body.value == .Locked) {
                        var strong_readable = response.body.value.Locked.readable;
                        response.body.value.Locked.readable = .{};
                        defer strong_readable.deinit();
                        if (strong_readable.get(globalThis)) |readable| {
                            readable.abort(globalThis);
                            any_js_calls = true;
                        }
                    }
                }
            }
        }

        // This function may be called multiple times
        // so it's important that we can safely do that
        pub fn finalizeWithoutDeinit(this: *RequestContext) void {
            ctxLog("finalizeWithoutDeinit<d> ({*})<r>", .{this});
            this.blob.detach();
            assert(this.server != null);
            const globalThis = this.server.?.globalThis;

            if (comptime Environment.allow_assert) {
                ctxLog("finalizeWithoutDeinit: has_finalized {any}", .{this.flags.has_finalized});
                this.flags.has_finalized = true;
            }

            if (this.response_jsvalue != .zero) {
                ctxLog("finalizeWithoutDeinit: response_jsvalue != .zero", .{});
                if (this.flags.response_protected) {
                    this.response_jsvalue.unprotect();
                    this.flags.response_protected = false;
                }
                this.response_jsvalue = JSC.JSValue.zero;
            }

            this.request_body_readable_stream_ref.deinit();

            if (this.cookies) |cookies| {
                this.cookies = null;
                cookies.deref();
            }

            if (this.request_weakref.get()) |request| {
                request.request_context = AnyRequestContext.Null;
                // we can already clean this strong refs
                request.internal_event_callback.deinit();
                this.request_weakref.deinit();
            }

            // if signal is not aborted, abort the signal
            if (this.signal) |signal| {
                this.signal = null;
                defer {
                    signal.pendingActivityUnref();
                    signal.unref();
                }
                if (this.flags.aborted and !signal.aborted()) {
                    signal.signal(globalThis, .ConnectionClosed);
                }
            }

            // Case 1:
            // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
            // but we received nothing or the connection was aborted
            // the promise is pending
            // Case 2:
            // User ignored the body and the connection was aborted or ended
            // Case 3:
            // Stream was not consumed and the connection was aborted or ended
            _ = this.endRequestStreaming();

            if (this.byte_stream) |stream| {
                ctxLog("finalizeWithoutDeinit: stream != null", .{});

                this.byte_stream = null;
                stream.unpipeWithoutDeref();
            }

            this.readable_stream_ref.deinit();

            if (!this.pathname.isEmpty()) {
                this.pathname.deref();
                this.pathname = bun.String.empty;
            }
        }

        pub fn endSendFile(this: *RequestContext, writeOffSet: usize, closeConnection: bool) void {
            if (this.resp) |resp| {
                defer this.deref();

                this.detachResponse();
                this.endRequestStreamingAndDrain();
                resp.endSendFile(writeOffSet, closeConnection);
            }
        }

        fn cleanupAndFinalizeAfterSendfile(this: *RequestContext) void {
            const sendfile = this.sendfile;
            this.endSendFile(sendfile.offset, this.shouldCloseConnection());

            // use node syscall so that we don't segfault on BADF
            if (sendfile.auto_close)
                _ = bun.sys.close(sendfile.fd);
        }
        const separator: string = "\r\n";
        const separator_iovec = [1]std.posix.iovec_const{.{
            .iov_base = separator.ptr,
            .iov_len = separator.len,
        }};

        pub fn onSendfile(this: *RequestContext) bool {
            if (this.isAbortedOrEnded()) {
                this.cleanupAndFinalizeAfterSendfile();
                return false;
            }
            const resp = this.resp.?;

            const adjusted_count_temporary = @min(@as(u64, this.sendfile.remain), @as(u63, std.math.maxInt(u63)));
            // TODO we should not need this int cast; improve the return type of `@min`
            const adjusted_count = @as(u63, @intCast(adjusted_count_temporary));

            if (Environment.isLinux) {
                var signed_offset = @as(i64, @intCast(this.sendfile.offset));
                const start = this.sendfile.offset;
                const val = linux.sendfile(this.sendfile.socket_fd.cast(), this.sendfile.fd.cast(), &signed_offset, this.sendfile.remain);
                this.sendfile.offset = @as(Blob.SizeType, @intCast(signed_offset));

                const errcode = bun.C.getErrno(val);

                this.sendfile.remain -|= @as(Blob.SizeType, @intCast(this.sendfile.offset -| start));

                if (errcode != .SUCCESS or this.isAbortedOrEnded() or this.sendfile.remain == 0 or val == 0) {
                    if (errcode != .AGAIN and errcode != .SUCCESS and errcode != .PIPE and errcode != .NOTCONN) {
                        Output.prettyErrorln("Error: {s}", .{@tagName(errcode)});
                        Output.flush();
                    }
                    this.cleanupAndFinalizeAfterSendfile();
                    return errcode != .SUCCESS;
                }
            } else {
                var sbytes: std.posix.off_t = adjusted_count;
                const signed_offset = @as(i64, @bitCast(@as(u64, this.sendfile.offset)));
                const errcode = bun.C.getErrno(std.c.sendfile(
                    this.sendfile.fd.cast(),
                    this.sendfile.socket_fd.cast(),
                    signed_offset,
                    &sbytes,
                    null,
                    0,
                ));
                const wrote = @as(Blob.SizeType, @intCast(sbytes));
                this.sendfile.offset +|= wrote;
                this.sendfile.remain -|= wrote;
                if (errcode != .AGAIN or this.isAbortedOrEnded() or this.sendfile.remain == 0 or sbytes == 0) {
                    if (errcode != .AGAIN and errcode != .SUCCESS and errcode != .PIPE and errcode != .NOTCONN) {
                        Output.prettyErrorln("Error: {s}", .{@tagName(errcode)});
                        Output.flush();
                    }
                    this.cleanupAndFinalizeAfterSendfile();
                    return errcode == .SUCCESS;
                }
            }

            if (!this.sendfile.has_set_on_writable) {
                this.sendfile.has_set_on_writable = true;
                this.flags.has_marked_pending = true;
                resp.onWritable(*RequestContext, onWritableSendfile, this);
            }

            resp.markNeedsMore();

            return true;
        }

        pub fn onWritableBytes(this: *RequestContext, write_offset: u64, resp: *App.Response) bool {
            ctxLog("onWritableBytes", .{});
            assert(this.resp == resp);
            if (this.isAbortedOrEnded()) {
                return false;
            }

            // Copy to stack memory to prevent aliasing issues in release builds
            const blob = this.blob;
            const bytes = blob.slice();

            _ = this.sendWritableBytesForBlob(bytes, write_offset, resp);
            return true;
        }

        pub fn sendWritableBytesForBlob(this: *RequestContext, bytes_: []const u8, write_offset_: u64, resp: *App.Response) bool {
            assert(this.resp == resp);
            const write_offset: usize = write_offset_;

            const bytes = bytes_[@min(bytes_.len, @as(usize, @truncate(write_offset)))..];
            if (resp.tryEnd(bytes, bytes_.len, this.shouldCloseConnection())) {
                this.detachResponse();
                this.endRequestStreamingAndDrain();
                this.deref();
                return true;
            } else {
                this.flags.has_marked_pending = true;
                resp.onWritable(*RequestContext, onWritableBytes, this);
                return true;
            }
        }

        pub fn sendWritableBytesForCompleteResponseBuffer(this: *RequestContext, bytes_: []const u8, write_offset_: u64, resp: *App.Response) bool {
            const write_offset: usize = write_offset_;
            assert(this.resp == resp);

            const bytes = bytes_[@min(bytes_.len, @as(usize, @truncate(write_offset)))..];
            if (resp.tryEnd(bytes, bytes_.len, this.shouldCloseConnection())) {
                this.response_buf_owned.items.len = 0;
                this.detachResponse();
                this.endRequestStreamingAndDrain();
                this.deref();
            } else {
                this.flags.has_marked_pending = true;
                resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
            }

            return true;
        }

        pub fn onWritableSendfile(this: *RequestContext, _: u64, _: *App.Response) bool {
            ctxLog("onWritableSendfile", .{});
            return this.onSendfile();
        }

        // We tried open() in another thread for this
        // it was not faster due to the mountain of syscalls
        pub fn renderSendFile(this: *RequestContext, blob: JSC.WebCore.Blob) void {
            if (this.resp == null or this.server == null) return;
            const globalThis = this.server.?.globalThis;
            const resp = this.resp.?;

            this.blob = .{ .Blob = blob };
            const file = &this.blob.store().?.data.file;
            var file_buf: bun.PathBuffer = undefined;
            const auto_close = file.pathlike != .fd;
            const fd = if (!auto_close)
                file.pathlike.fd
            else switch (bun.sys.open(file.pathlike.path.sliceZ(&file_buf), bun.O.RDONLY | bun.O.NONBLOCK | bun.O.CLOEXEC, 0)) {
                .result => |_fd| _fd,
                .err => |err| return this.runErrorHandler(err.withPath(file.pathlike.path.slice()).toJSC(globalThis)),
            };

            // stat only blocks if the target is a file descriptor
            const stat: bun.Stat = switch (bun.sys.fstat(fd)) {
                .result => |result| result,
                .err => |err| {
                    this.runErrorHandler(err.withPathLike(file.pathlike).toJSC(globalThis));
                    if (auto_close) {
                        _ = bun.sys.close(fd);
                    }
                    return;
                },
            };

            if (Environment.isMac) {
                if (!bun.isRegularFile(stat.mode)) {
                    if (auto_close) {
                        _ = bun.sys.close(fd);
                    }

                    var err = bun.sys.Error{
                        .errno = @as(bun.sys.Error.Int, @intCast(@intFromEnum(std.posix.E.INVAL))),
                        .syscall = .sendfile,
                    };
                    var sys = err.withPathLike(file.pathlike).toSystemError();
                    sys.message = bun.String.static("MacOS does not support sending non-regular files");
                    this.runErrorHandler(sys.toErrorInstance(
                        globalThis,
                    ));
                    return;
                }
            }

            if (Environment.isLinux) {
                if (!(bun.isRegularFile(stat.mode) or std.posix.S.ISFIFO(stat.mode) or std.posix.S.ISSOCK(stat.mode))) {
                    if (auto_close) {
                        _ = bun.sys.close(fd);
                    }

                    var err = bun.sys.Error{
                        .errno = @as(bun.sys.Error.Int, @intCast(@intFromEnum(std.posix.E.INVAL))),
                        .syscall = .sendfile,
                    };
                    var sys = err.withPathLike(file.pathlike).toShellSystemError();
                    sys.message = bun.String.static("File must be regular or FIFO");
                    this.runErrorHandler(sys.toErrorInstance(globalThis));
                    return;
                }
            }

            const original_size = this.blob.Blob.size;
            const stat_size = @as(Blob.SizeType, @intCast(stat.size));
            this.blob.Blob.size = if (bun.isRegularFile(stat.mode))
                stat_size
            else
                @min(original_size, stat_size);

            this.flags.needs_content_length = true;

            this.sendfile = .{
                .fd = fd,
                .remain = this.blob.Blob.offset + original_size,
                .offset = this.blob.Blob.offset,
                .auto_close = auto_close,
                .socket_fd = if (!this.isAbortedOrEnded()) resp.getNativeHandle() else bun.invalid_fd,
            };

            // if we are sending only part of a file, include the content-range header
            // only include content-range automatically when using a file path instead of an fd
            // this is to better support manually controlling the behavior
            if (bun.isRegularFile(stat.mode) and auto_close) {
                this.flags.needs_content_range = (this.sendfile.remain -| this.sendfile.offset) != stat_size;
            }

            // we know the bounds when we are sending a regular file
            if (bun.isRegularFile(stat.mode)) {
                this.sendfile.offset = @min(this.sendfile.offset, stat_size);
                this.sendfile.remain = @min(@max(this.sendfile.remain, this.sendfile.offset), stat_size) -| this.sendfile.offset;
            }

            resp.runCorkedWithType(*RequestContext, renderMetadataAndNewline, this);

            if (this.sendfile.remain == 0 or !this.method.hasBody()) {
                this.cleanupAndFinalizeAfterSendfile();
                return;
            }

            _ = this.onSendfile();
        }

        pub fn renderMetadataAndNewline(this: *RequestContext) void {
            if (this.resp) |resp| {
                this.renderMetadata();
                resp.prepareForSendfile();
            }
        }

        pub fn doSendfile(this: *RequestContext, blob: Blob) void {
            if (this.isAbortedOrEnded()) {
                return;
            }

            if (this.flags.has_sendfile_ctx) return;

            this.flags.has_sendfile_ctx = true;

            if (comptime can_sendfile) {
                return this.renderSendFile(blob);
            }
            if (this.server) |server| {
                this.ref();
                this.blob.Blob.doReadFileInternal(*RequestContext, this, onReadFile, server.globalThis);
            }
        }

        pub fn onReadFile(this: *RequestContext, result: Blob.ReadFileResultType) void {
            defer this.deref();

            if (this.isAbortedOrEnded()) {
                return;
            }

            if (result == .err) {
                if (this.server) |server| {
                    this.runErrorHandler(result.err.toErrorInstance(server.globalThis));
                }
                return;
            }

            const is_temporary = result.result.is_temporary;

            if (comptime Environment.allow_assert) {
                assert(this.blob == .Blob);
            }

            if (!is_temporary) {
                this.blob.Blob.resolveSize();
                this.doRenderBlob();
            } else {
                const stat_size = @as(Blob.SizeType, @intCast(result.result.total_size));

                if (this.blob == .Blob) {
                    const original_size = this.blob.Blob.size;
                    // if we dont know the size we use the stat size
                    this.blob.Blob.size = if (original_size == 0 or original_size == Blob.max_size)
                        stat_size
                    else // the blob can be a slice of a file
                        @max(original_size, stat_size);
                }

                if (!this.flags.has_written_status)
                    this.flags.needs_content_range = true;

                // this is used by content-range
                this.sendfile = .{
                    .fd = bun.invalid_fd,
                    .remain = @as(Blob.SizeType, @truncate(result.result.buf.len)),
                    .offset = if (this.blob == .Blob) this.blob.Blob.offset else 0,
                    .auto_close = false,
                    .socket_fd = bun.invalid_fd,
                };

                this.response_buf_owned = .{ .items = result.result.buf, .capacity = result.result.buf.len };
                this.resp.?.runCorkedWithType(*RequestContext, renderResponseBufferAndMetadata, this);
            }
        }

        pub fn doRenderWithBodyLocked(this: *anyopaque, value: *JSC.WebCore.Body.Value) void {
            doRenderWithBody(bun.cast(*RequestContext, this), value);
        }

        fn renderWithBlobFromBodyValue(this: *RequestContext) void {
            if (this.isAbortedOrEnded()) {
                return;
            }

            if (this.blob.needsToReadFile()) {
                if (!this.flags.has_sendfile_ctx)
                    this.doSendfile(this.blob.Blob);
                return;
            }

            this.doRenderBlob();
        }

        const StreamPair = struct { this: *RequestContext, stream: JSC.WebCore.ReadableStream };

        fn handleFirstStreamWrite(this: *@This()) void {
            if (!this.flags.has_written_status) {
                this.renderMetadata();
            }
        }

        fn doRenderStream(pair: *StreamPair) void {
            ctxLog("doRenderStream", .{});
            var this = pair.this;
            var stream = pair.stream;
            assert(this.server != null);
            const globalThis = this.server.?.globalThis;

            if (this.isAbortedOrEnded()) {
                stream.cancel(globalThis);
                this.readable_stream_ref.deinit();
                return;
            }
            const resp = this.resp.?;

            stream.value.ensureStillAlive();

            var response_stream = this.allocator.create(ResponseStream.JSSink) catch unreachable;
            response_stream.* = ResponseStream.JSSink{
                .sink = .{
                    .res = resp,
                    .allocator = this.allocator,
                    .buffer = bun.ByteList{},
                    .onFirstWrite = @ptrCast(&handleFirstStreamWrite),
                    .ctx = this,
                    .globalThis = globalThis,
                },
            };
            var signal = &response_stream.sink.signal;
            this.sink = response_stream;

            signal.* = ResponseStream.JSSink.SinkSignal.init(JSValue.zero);

            // explicitly set it to a dead pointer
            // we use this memory address to disable signals being sent
            signal.clear();
            assert(signal.isDead());
            // we need to render metadata before assignToStream because the stream can call res.end
            // and this would auto write an 200 status
            if (!this.flags.has_written_status) {
                this.renderMetadata();
            }
            // We are already corked!
            const assignment_result: JSValue = ResponseStream.JSSink.assignToStream(
                globalThis,
                stream.value,
                response_stream,
                @as(**anyopaque, @ptrCast(&signal.ptr)),
            );

            assignment_result.ensureStillAlive();

            // assert that it was updated
            assert(!signal.isDead());

            if (comptime Environment.allow_assert) {
                if (resp.hasResponded()) {
                    streamLog("responded", .{});
                }
            }

            this.flags.aborted = this.flags.aborted or response_stream.sink.aborted;

            if (assignment_result.toError()) |err_value| {
                streamLog("returned an error", .{});
                response_stream.detach();
                this.sink = null;
                response_stream.sink.destroy();
                return this.handleReject(err_value);
            }

            if (resp.hasResponded()) {
                streamLog("done", .{});
                response_stream.detach();
                this.sink = null;
                response_stream.sink.destroy();
                stream.done(globalThis);
                this.readable_stream_ref.deinit();
                this.endStream(this.shouldCloseConnection());
                return;
            }

            if (!assignment_result.isEmptyOrUndefinedOrNull()) {
                assignment_result.ensureStillAlive();
                // it returns a Promise when it goes through ReadableStreamDefaultReader
                if (assignment_result.asAnyPromise()) |promise| {
                    streamLog("returned a promise", .{});
                    this.drainMicrotasks();

                    switch (promise.status(globalThis.vm())) {
                        .pending => {
                            streamLog("promise still Pending", .{});
                            if (!this.flags.has_written_status) {
                                response_stream.sink.onFirstWrite = null;
                                response_stream.sink.ctx = null;
                                this.renderMetadata();
                            }

                            // TODO: should this timeout?
                            this.response_ptr.?.body.value = .{
                                .Locked = .{
                                    .readable = JSC.WebCore.ReadableStream.Strong.init(stream, globalThis),
                                    .global = globalThis,
                                },
                            };
                            this.ref();
                            assignment_result.then(
                                globalThis,
                                this,
                                onResolveStream,
                                onRejectStream,
                            );
                            // the response_stream should be GC'd

                        },
                        .fulfilled => {
                            streamLog("promise Fulfilled", .{});
                            var readable_stream_ref = this.readable_stream_ref;
                            this.readable_stream_ref = .{};
                            defer {
                                stream.done(globalThis);
                                readable_stream_ref.deinit();
                            }

                            this.handleResolveStream();
                        },
                        .rejected => {
                            streamLog("promise Rejected", .{});
                            var readable_stream_ref = this.readable_stream_ref;
                            this.readable_stream_ref = .{};
                            defer {
                                stream.cancel(globalThis);
                                readable_stream_ref.deinit();
                            }
                            this.handleRejectStream(globalThis, promise.result(globalThis.vm()));
                        },
                    }
                    return;
                } else {
                    // if is not a promise we treat it as Error
                    streamLog("returned an error", .{});
                    response_stream.detach();
                    this.sink = null;
                    response_stream.sink.destroy();
                    return this.handleReject(assignment_result);
                }
            }

            if (this.isAbortedOrEnded()) {
                response_stream.detach();
                stream.cancel(globalThis);
                defer this.readable_stream_ref.deinit();

                response_stream.sink.markDone();
                response_stream.sink.onFirstWrite = null;

                response_stream.sink.finalize();
                return;
            }
            var readable_stream_ref = this.readable_stream_ref;
            this.readable_stream_ref = .{};
            defer readable_stream_ref.deinit();

            const is_in_progress = response_stream.sink.has_backpressure or !(response_stream.sink.wrote == 0 and
                response_stream.sink.buffer.len == 0);

            if (!stream.isLocked(globalThis) and !is_in_progress) {
                if (JSC.WebCore.ReadableStream.fromJS(stream.value, globalThis)) |comparator| {
                    if (std.meta.activeTag(comparator.ptr) == std.meta.activeTag(stream.ptr)) {
                        streamLog("is not locked", .{});
                        this.renderMissing();
                        return;
                    }
                }
            }

            streamLog("is in progress, but did not return a Promise. Finalizing request context", .{});
            response_stream.sink.onFirstWrite = null;
            response_stream.sink.ctx = null;
            response_stream.detach();
            stream.cancel(globalThis);
            response_stream.sink.markDone();
            this.renderMissing();
        }

        const streamLog = Output.scoped(.ReadableStream, false);

        pub fn didUpgradeWebSocket(this: *RequestContext) bool {
            return @intFromPtr(this.upgrade_context) == std.math.maxInt(usize);
        }

        fn toAsyncWithoutAbortHandler(ctx: *RequestContext, req: *uws.Request, request_object: *Request) void {
            request_object.request_context.setRequest(req);
            assert(ctx.server != null);

            request_object.ensureURL() catch {
                request_object.url = bun.String.empty;
            };

            // we have to clone the request headers here since they will soon belong to a different request
            if (!request_object.hasFetchHeaders()) {
                request_object.setFetchHeaders(JSC.FetchHeaders.createFromUWS(req));
            }

            // This object dies after the stack frame is popped
            // so we have to clear it in here too
            request_object.request_context.detachRequest();
        }

        fn toAsync(
            ctx: *RequestContext,
            req: *uws.Request,
            request_object: *Request,
        ) void {
            ctxLog("toAsync", .{});
            ctx.toAsyncWithoutAbortHandler(req, request_object);
            if (comptime debug_mode) {
                ctx.pathname = request_object.url.clone();
            }
            ctx.setAbortHandler();
        }

        fn endRequestStreamingAndDrain(this: *RequestContext) void {
            assert(this.server != null);

            if (this.endRequestStreaming()) {
                this.server.?.vm.drainMicrotasks();
            }
        }
        fn endRequestStreaming(this: *RequestContext) bool {
            assert(this.server != null);

            this.request_body_buf.clearAndFree(bun.default_allocator);

            // if we cannot, we have to reject pending promises
            // first, we reject the request body promise
            if (this.request_body) |body| {
                // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
                // but we received nothing or the connection was aborted
                if (body.value == .Locked) {
                    body.value.toErrorInstance(.{ .AbortReason = .ConnectionClosed }, this.server.?.globalThis);
                    return true;
                }
            }
            return false;
        }
        fn detachResponse(this: *RequestContext) void {
            this.request_body_buf.clearAndFree(bun.default_allocator);

            if (this.resp) |resp| {
                this.resp = null;

                if (this.flags.is_waiting_for_request_body) {
                    this.flags.is_waiting_for_request_body = false;
                    resp.clearOnData();
                }
                if (this.flags.has_abort_handler) {
                    resp.clearAborted();
                    this.flags.has_abort_handler = false;
                }
                if (this.flags.has_timeout_handler) {
                    resp.clearTimeout();
                    this.flags.has_timeout_handler = false;
                }
            }
        }

        fn isAbortedOrEnded(this: *const RequestContext) bool {
            // resp == null or aborted or server.stop(true)
            return this.resp == null or this.flags.aborted or this.server == null or this.server.?.flags.terminated;
        }
        const HeaderResponseSizePair = struct { this: *RequestContext, size: usize };
        pub fn doRenderHeadResponseAfterS3SizeResolved(pair: *HeaderResponseSizePair) void {
            var this = pair.this;
            this.renderMetadata();

            if (this.resp) |resp| {
                resp.writeHeaderInt("content-length", pair.size);
            }
            this.endWithoutBody(this.shouldCloseConnection());
            this.deref();
        }
        pub fn onS3SizeResolved(result: S3.S3StatResult, this: *RequestContext) void {
            defer {
                this.deref();
            }
            if (this.resp) |resp| {
                var pair = HeaderResponseSizePair{ .this = this, .size = switch (result) {
                    .failure, .not_found => 0,
                    .success => |stat| stat.size,
                } };
                resp.runCorkedWithType(*HeaderResponseSizePair, doRenderHeadResponseAfterS3SizeResolved, &pair);
            }
        }
        const HeaderResponsePair = struct { this: *RequestContext, response: *JSC.WebCore.Response };

        fn doRenderHeadResponse(pair: *HeaderResponsePair) void {
            var this = pair.this;
            var response = pair.response;
            if (this.resp == null) {
                return;
            }
            // we will render the content-length header later manually so we set this to false
            this.flags.needs_content_length = false;
            // Always this.renderMetadata() before sending the content-length or transfer-encoding header so status is sent first

            const resp = this.resp.?;
            this.response_ptr = response;
            const server = this.server orelse {
                // server detached?
                this.renderMetadata();
                resp.writeHeaderInt("content-length", 0);
                this.endWithoutBody(this.shouldCloseConnection());
                return;
            };
            const globalThis = server.globalThis;
            if (response.getFetchHeaders()) |headers| {
                // first respect the headers
                if (headers.fastGet(.TransferEncoding)) |transfer_encoding| {
                    const transfer_encoding_str = transfer_encoding.toSlice(server.allocator);
                    defer transfer_encoding_str.deinit();
                    this.renderMetadata();
                    resp.writeHeader("transfer-encoding", transfer_encoding_str.slice());
                    this.endWithoutBody(this.shouldCloseConnection());

                    return;
                }
                if (headers.fastGet(.ContentLength)) |content_length| {
                    const content_length_str = content_length.toSlice(server.allocator);
                    defer content_length_str.deinit();
                    this.renderMetadata();

                    const len = std.fmt.parseInt(usize, content_length_str.slice(), 10) catch 0;
                    resp.writeHeaderInt("content-length", len);
                    this.endWithoutBody(this.shouldCloseConnection());
                    return;
                }
            }
            // not content-length or transfer-encoding so we need to respect the body
            response.body.value.toBlobIfPossible();
            switch (response.body.value) {
                .InternalBlob, .WTFStringImpl => {
                    var blob = response.body.value.useAsAnyBlobAllowNonUTF8String();
                    defer blob.detach();
                    const size = blob.size();
                    this.renderMetadata();

                    if (size == Blob.max_size) {
                        resp.writeHeaderInt("content-length", 0);
                    } else {
                        resp.writeHeaderInt("content-length", size);
                    }
                    this.endWithoutBody(this.shouldCloseConnection());
                },

                .Blob => |*blob| {
                    if (blob.isS3()) {
                        // we need to read the size asynchronously
                        // in this case should always be a redirect so should not hit this path, but in case we change it in the future lets handle it
                        this.ref();

                        const credentials = blob.store.?.data.s3.getCredentials();
                        const path = blob.store.?.data.s3.path();
                        const env = globalThis.bunVM().transpiler.env;

                        S3.stat(credentials, path, @ptrCast(&onS3SizeResolved), this, if (env.getHttpProxy(true, null)) |proxy| proxy.href else null);

                        return;
                    }
                    this.renderMetadata();

                    blob.resolveSize();
                    if (blob.size == Blob.max_size) {
                        resp.writeHeaderInt("content-length", 0);
                    } else {
                        resp.writeHeaderInt("content-length", blob.size);
                    }
                    this.endWithoutBody(this.shouldCloseConnection());
                },
                .Locked => {
                    this.renderMetadata();
                    resp.writeHeader("transfer-encoding", "chunked");
                    this.endWithoutBody(this.shouldCloseConnection());
                },
                .Used, .Null, .Empty, .Error => {
                    this.renderMetadata();
                    resp.writeHeaderInt("content-length", 0);
                    this.endWithoutBody(this.shouldCloseConnection());
                },
            }
        }

        // Each HTTP request or TCP socket connection is effectively a "task".
        //
        // However, unlike the regular task queue, we don't drain the microtask
        // queue at the end.
        //
        // Instead, we drain it multiple times, at the points that would
        // otherwise "halt" the Response from being rendered.
        //
        // - If you return a Promise, we drain the microtask queue once
        // - If you return a streaming Response, we drain the microtask queue (possibly the 2nd time this task!)
        pub fn onResponse(
            ctx: *RequestContext,
            this: *ThisServer,
            request_value: JSValue,
            response_value: JSValue,
        ) void {
            request_value.ensureStillAlive();
            response_value.ensureStillAlive();
            ctx.drainMicrotasks();

            if (ctx.isAbortedOrEnded()) {
                return;
            }
            // if you return a Response object or a Promise<Response>
            // but you upgraded the connection to a WebSocket
            // just ignore the Response object. It doesn't do anything.
            // it's better to do that than to throw an error
            if (ctx.didUpgradeWebSocket()) {
                return;
            }

            if (response_value.isEmptyOrUndefinedOrNull()) {
                ctx.renderMissingInvalidResponse(response_value);
                return;
            }

            if (response_value.toError()) |err_value| {
                ctx.runErrorHandler(err_value);
                return;
            }

            if (response_value.as(JSC.WebCore.Response)) |response| {
                ctx.response_jsvalue = response_value;
                ctx.response_jsvalue.ensureStillAlive();
                ctx.flags.response_protected = false;
                if (ctx.method == .HEAD) {
                    if (ctx.resp) |resp| {
                        var pair = HeaderResponsePair{ .this = ctx, .response = response };
                        resp.runCorkedWithType(*HeaderResponsePair, doRenderHeadResponse, &pair);
                    }
                    return;
                } else {
                    response.body.value.toBlobIfPossible();

                    switch (response.body.value) {
                        .Blob => |*blob| {
                            if (blob.needsToReadFile()) {
                                response_value.protect();
                                ctx.flags.response_protected = true;
                            }
                        },
                        .Locked => {
                            response_value.protect();
                            ctx.flags.response_protected = true;
                        },
                        else => {},
                    }
                    ctx.render(response);
                }
                return;
            }

            var vm = this.vm;

            if (response_value.asAnyPromise()) |promise| {
                // If we immediately have the value available, we can skip the extra event loop tick
                switch (promise.unwrap(vm.global.vm(), .mark_handled)) {
                    .pending => {
                        ctx.ref();
                        response_value.then(this.globalThis, ctx, RequestContext.onResolve, RequestContext.onReject);
                        return;
                    },
                    .fulfilled => |fulfilled_value| {
                        // if you return a Response object or a Promise<Response>
                        // but you upgraded the connection to a WebSocket
                        // just ignore the Response object. It doesn't do anything.
                        // it's better to do that than to throw an error
                        if (ctx.didUpgradeWebSocket()) {
                            return;
                        }

                        if (fulfilled_value.isEmptyOrUndefinedOrNull()) {
                            ctx.renderMissingInvalidResponse(fulfilled_value);
                            return;
                        }
                        var response = fulfilled_value.as(JSC.WebCore.Response) orelse {
                            ctx.renderMissingInvalidResponse(fulfilled_value);
                            return;
                        };

                        ctx.response_jsvalue = fulfilled_value;
                        ctx.response_jsvalue.ensureStillAlive();
                        ctx.flags.response_protected = false;
                        ctx.response_ptr = response;
                        if (ctx.method == .HEAD) {
                            if (ctx.resp) |resp| {
                                var pair = HeaderResponsePair{ .this = ctx, .response = response };
                                resp.runCorkedWithType(*HeaderResponsePair, doRenderHeadResponse, &pair);
                            }
                            return;
                        }
                        response.body.value.toBlobIfPossible();
                        switch (response.body.value) {
                            .Blob => |*blob| {
                                if (blob.needsToReadFile()) {
                                    fulfilled_value.protect();
                                    ctx.flags.response_protected = true;
                                }
                            },
                            .Locked => {
                                fulfilled_value.protect();
                                ctx.flags.response_protected = true;
                            },
                            else => {},
                        }
                        ctx.render(response);
                        return;
                    },
                    .rejected => |err| {
                        ctx.handleReject(err);
                        return;
                    },
                }
            }
        }

        pub fn handleResolveStream(req: *RequestContext) void {
            streamLog("handleResolveStream", .{});

            var wrote_anything = false;
            if (req.sink) |wrapper| {
                req.flags.aborted = req.flags.aborted or wrapper.sink.aborted;
                wrote_anything = wrapper.sink.wrote > 0;

                wrapper.sink.finalize();
                wrapper.detach();
                req.sink = null;
                wrapper.sink.destroy();
            }

            if (req.response_ptr) |resp| {
                assert(req.server != null);

                if (resp.body.value == .Locked) {
                    const global = resp.body.value.Locked.global;
                    if (resp.body.value.Locked.readable.get(global)) |stream| {
                        stream.done(global);
                    }
                    resp.body.value.Locked.readable.deinit();
                    resp.body.value = .{ .Used = {} };
                }
            }

            if (req.isAbortedOrEnded()) {
                return;
            }

            streamLog("onResolve({any})", .{wrote_anything});
            if (!req.flags.has_written_status) {
                req.renderMetadata();
            }
            req.endStream(req.shouldCloseConnection());
        }

        pub fn onResolveStream(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            streamLog("onResolveStream", .{});
            var args = callframe.arguments_old(2);
            var req: *@This() = args.ptr[args.len - 1].asPromisePtr(@This());
            defer req.deref();
            req.handleResolveStream();
            return JSValue.jsUndefined();
        }
        pub fn onRejectStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            streamLog("onRejectStream", .{});
            const args = callframe.arguments_old(2);
            var req = args.ptr[args.len - 1].asPromisePtr(@This());
            const err = args.ptr[0];
            defer req.deref();

            req.handleRejectStream(globalThis, err);
            return JSValue.jsUndefined();
        }

        pub fn handleRejectStream(req: *@This(), globalThis: *JSC.JSGlobalObject, err: JSValue) void {
            streamLog("handleRejectStream", .{});

            if (req.sink) |wrapper| {
                wrapper.sink.pending_flush = null;
                wrapper.sink.done = true;
                req.flags.aborted = req.flags.aborted or wrapper.sink.aborted;
                wrapper.sink.finalize();
                wrapper.detach();
                req.sink = null;
                wrapper.sink.destroy();
            }

            if (req.response_ptr) |resp| {
                if (resp.body.value == .Locked) {
                    if (resp.body.value.Locked.readable.get(globalThis)) |stream| {
                        stream.done(globalThis);
                    }
                    resp.body.value.Locked.readable.deinit();
                    resp.body.value = .{ .Used = {} };
                }
            }

            // aborted so call finalizeForAbort
            if (req.isAbortedOrEnded()) {
                return;
            }

            streamLog("onReject()", .{});

            if (!req.flags.has_written_status) {
                req.renderMetadata();
            }

            if (comptime debug_mode) {
                if (req.server) |server| {
                    if (!err.isEmptyOrUndefinedOrNull()) {
                        var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(req.allocator);
                        defer exception_list.deinit();
                        server.vm.runErrorHandler(err, &exception_list);
                    }
                }
            }
            req.endStream(true);
        }

        pub fn doRenderWithBody(this: *RequestContext, value: *JSC.WebCore.Body.Value) void {
            this.drainMicrotasks();

            // If a ReadableStream can trivially be converted to a Blob, do so.
            // If it's a WTFStringImpl and it cannot be used as a UTF-8 string, convert it to a Blob.
            value.toBlobIfPossible();
            const globalThis = this.server.?.globalThis;
            switch (value.*) {
                .Error => |*err_ref| {
                    _ = value.use();
                    if (this.isAbortedOrEnded()) {
                        return;
                    }
                    this.runErrorHandler(err_ref.toJS(globalThis));
                    return;
                },
                // .InlineBlob,
                .WTFStringImpl,
                .InternalBlob,
                .Blob,
                => {
                    // toBlobIfPossible checks for WTFString needing a conversion.
                    this.blob = value.useAsAnyBlobAllowNonUTF8String();
                    this.renderWithBlobFromBodyValue();
                    return;
                },
                .Locked => |*lock| {
                    if (this.isAbortedOrEnded()) {
                        return;
                    }

                    if (lock.readable.get(globalThis)) |stream_| {
                        const stream: JSC.WebCore.ReadableStream = stream_;
                        // we hold the stream alive until we're done with it
                        this.readable_stream_ref = lock.readable;
                        value.* = .{ .Used = {} };

                        if (stream.isLocked(globalThis)) {
                            streamLog("was locked but it shouldn't be", .{});
                            var err = JSC.SystemError{
                                .code = bun.String.static(@tagName(JSC.Node.ErrorCode.ERR_STREAM_CANNOT_PIPE)),
                                .message = bun.String.static("Stream already used, please create a new one"),
                            };
                            stream.value.unprotect();
                            this.runErrorHandler(err.toErrorInstance(globalThis));
                            return;
                        }

                        switch (stream.ptr) {
                            .Invalid => {
                                this.readable_stream_ref.deinit();
                            },
                            // toBlobIfPossible will typically convert .Blob streams, or .File streams into a Blob object, but cannot always.
                            .Blob,
                            .File,
                            // These are the common scenario:
                            .JavaScript,
                            .Direct,
                            => {
                                if (this.resp) |resp| {
                                    var pair = StreamPair{ .stream = stream, .this = this };
                                    resp.runCorkedWithType(*StreamPair, doRenderStream, &pair);
                                }
                                return;
                            },

                            .Bytes => |byte_stream| {
                                assert(byte_stream.pipe.ctx == null);
                                assert(this.byte_stream == null);
                                if (this.resp == null) {
                                    // we don't have a response, so we can discard the stream
                                    stream.done(globalThis);
                                    this.readable_stream_ref.deinit();
                                    return;
                                }
                                const resp = this.resp.?;
                                // If we've received the complete body by the time this function is called
                                // we can avoid streaming it and just send it all at once.
                                if (byte_stream.has_received_last_chunk) {
                                    this.blob = .fromArrayList(byte_stream.drain().listManaged(bun.default_allocator));
                                    this.readable_stream_ref.deinit();
                                    this.doRenderBlob();
                                    return;
                                }
                                this.ref();
                                byte_stream.pipe = JSC.WebCore.Pipe.New(@This(), onPipe).init(this);
                                this.readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(stream, globalThis);

                                this.byte_stream = byte_stream;
                                this.response_buf_owned = byte_stream.drain().list();

                                // we don't set size here because even if we have a hint
                                // uWebSockets won't let us partially write streaming content
                                this.blob.detach();

                                // if we've received metadata and part of the body, send everything we can and drain
                                if (this.response_buf_owned.items.len > 0) {
                                    resp.runCorkedWithType(*RequestContext, drainResponseBufferAndMetadata, this);
                                } else {
                                    // if we only have metadata to send, send it now
                                    resp.runCorkedWithType(*RequestContext, renderMetadata, this);
                                }
                                return;
                            },
                        }
                    }

                    if (lock.onReceiveValue != null or lock.task != null) {
                        // someone else is waiting for the stream or waiting for `onStartStreaming`
                        const readable = value.toReadableStream(globalThis);
                        readable.ensureStillAlive();
                        this.doRenderWithBody(value);
                        return;
                    }

                    // when there's no stream, we need to
                    lock.onReceiveValue = doRenderWithBodyLocked;
                    lock.task = this;

                    return;
                },
                else => {},
            }

            this.doRenderBlob();
        }

        pub fn onPipe(this: *RequestContext, stream: JSC.WebCore.StreamResult, allocator: std.mem.Allocator) void {
            const stream_needs_deinit = stream == .owned or stream == .owned_and_done;
            const is_done = stream.isDone();
            defer {
                if (is_done) this.deref();
                if (stream_needs_deinit) {
                    if (is_done) {
                        stream.owned_and_done.listManaged(allocator).deinit();
                    } else {
                        stream.owned.listManaged(allocator).deinit();
                    }
                }
            }

            if (this.isAbortedOrEnded()) {
                return;
            }
            const resp = this.resp.?;

            const chunk = stream.slice();
            // on failure, it will continue to allocate
            // we can't do buffering ourselves here or it won't work
            // uSockets will append and manage the buffer
            // so any write will buffer if the write fails
            if (resp.write(chunk) == .want_more) {
                if (is_done) {
                    this.endStream(this.shouldCloseConnection());
                }
            } else {
                // when it's the last one, we just want to know if it's done
                if (is_done) {
                    this.flags.has_marked_pending = true;
                    resp.onWritable(*RequestContext, onWritableResponseBuffer, this);
                }
            }
        }

        pub fn doRenderBlob(this: *RequestContext) void {
            // We are not corked
            // The body is small
            // Faster to do the memcpy than to do the two network calls
            // We are not streaming
            // This is an important performance optimization
            if (this.flags.has_abort_handler and this.blob.fastSize() < 16384 - 1024) {
                if (this.resp) |resp| {
                    resp.runCorkedWithType(*RequestContext, doRenderBlobCorked, this);
                }
            } else {
                this.doRenderBlobCorked();
            }
        }

        pub fn doRenderBlobCorked(this: *RequestContext) void {
            this.renderMetadata();
            this.renderBytes();
        }

        pub fn doRender(this: *RequestContext) void {
            ctxLog("doRender", .{});

            if (this.isAbortedOrEnded()) {
                return;
            }
            var response = this.response_ptr.?;
            this.doRenderWithBody(&response.body.value);
        }

        pub fn renderProductionError(this: *RequestContext, status: u16) void {
            if (this.resp) |resp| {
                switch (status) {
                    404 => {
                        if (!this.flags.has_written_status) {
                            resp.writeStatus("404 Not Found");
                            this.flags.has_written_status = true;
                        }
                        this.endWithoutBody(this.shouldCloseConnection());
                    },
                    else => {
                        if (!this.flags.has_written_status) {
                            resp.writeStatus("500 Internal Server Error");
                            resp.writeHeader("content-type", "text/plain");
                            this.flags.has_written_status = true;
                        }

                        this.end("Something went wrong!", this.shouldCloseConnection());
                    },
                }
            }
        }

        pub fn runErrorHandler(
            this: *RequestContext,
            value: JSC.JSValue,
        ) void {
            runErrorHandlerWithStatusCode(this, value, 500);
        }

        const PathnameFormatter = struct {
            ctx: *RequestContext,

            pub fn format(formatter: @This(), comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                var this = formatter.ctx;

                if (!this.pathname.isEmpty()) {
                    try this.pathname.format(fmt, opts, writer);
                    return;
                }

                if (!this.flags.has_abort_handler) {
                    if (this.req) |req| {
                        try writer.writeAll(req.url());
                        return;
                    }
                }

                try writer.writeAll("/");
            }
        };

        fn ensurePathname(this: *RequestContext) PathnameFormatter {
            return .{ .ctx = this };
        }

        pub inline fn shouldCloseConnection(this: *const RequestContext) bool {
            if (this.resp) |resp| {
                return resp.shouldCloseConnection();
            }
            return false;
        }

        fn finishRunningErrorHandler(this: *RequestContext, value: JSC.JSValue, status: u16) void {
            if (this.server == null) return this.renderProductionError(status);
            var vm: *JSC.VirtualMachine = this.server.?.vm;
            const globalThis = this.server.?.globalThis;
            if (comptime debug_mode) {
                var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(this.allocator);
                defer exception_list.deinit();
                const prev_exception_list = vm.onUnhandledRejectionExceptionList;
                vm.onUnhandledRejectionExceptionList = &exception_list;
                vm.onUnhandledRejection(vm, globalThis, value);
                vm.onUnhandledRejectionExceptionList = prev_exception_list;

                this.renderDefaultError(
                    vm.log,
                    error.ExceptionOcurred,
                    exception_list.toOwnedSlice() catch @panic("TODO"),
                    "<r><red>{s}<r> - <b>{}<r> failed",
                    .{ @as(string, @tagName(this.method)), this.ensurePathname() },
                );
            } else {
                if (status != 404) {
                    vm.onUnhandledRejection(vm, globalThis, value);
                }
                this.renderProductionError(status);
            }

            vm.log.reset();
        }

        pub fn runErrorHandlerWithStatusCodeDontCheckResponded(
            this: *RequestContext,
            value: JSC.JSValue,
            status: u16,
        ) void {
            JSC.markBinding(@src());
            if (this.server) |server| {
                if (server.config.onError != .zero and !this.flags.has_called_error_handler) {
                    this.flags.has_called_error_handler = true;
                    const result = server.config.onError.call(
                        server.globalThis,
                        server.js_value.get() orelse .undefined,
                        &.{value},
                    ) catch |err| server.globalThis.takeException(err);
                    defer result.ensureStillAlive();
                    if (!result.isEmptyOrUndefinedOrNull()) {
                        if (result.toError()) |err| {
                            this.finishRunningErrorHandler(err, status);
                            return;
                        } else if (result.asAnyPromise()) |promise| {
                            this.processOnErrorPromise(result, promise, value, status);
                            return;
                        } else if (result.as(Response)) |response| {
                            this.render(response);
                            return;
                        }
                    }
                }
            }

            this.finishRunningErrorHandler(value, status);
        }

        fn processOnErrorPromise(
            ctx: *RequestContext,
            promise_js: JSC.JSValue,
            promise: JSC.AnyPromise,
            value: JSC.JSValue,
            status: u16,
        ) void {
            assert(ctx.server != null);
            var vm = ctx.server.?.vm;

            switch (promise.unwrap(vm.global.vm(), .mark_handled)) {
                .pending => {
                    ctx.flags.is_error_promise_pending = true;
                    ctx.ref();
                    promise_js.then(
                        ctx.server.?.globalThis,
                        ctx,
                        RequestContext.onResolve,
                        RequestContext.onReject,
                    );
                },
                .fulfilled => |fulfilled_value| {
                    // if you return a Response object or a Promise<Response>
                    // but you upgraded the connection to a WebSocket
                    // just ignore the Response object. It doesn't do anything.
                    // it's better to do that than to throw an error
                    if (ctx.didUpgradeWebSocket()) {
                        return;
                    }

                    var response = fulfilled_value.as(JSC.WebCore.Response) orelse {
                        ctx.finishRunningErrorHandler(value, status);
                        return;
                    };

                    ctx.response_jsvalue = fulfilled_value;
                    ctx.response_jsvalue.ensureStillAlive();
                    ctx.flags.response_protected = false;
                    ctx.response_ptr = response;

                    response.body.value.toBlobIfPossible();
                    switch (response.body.value) {
                        .Blob => |*blob| {
                            if (blob.needsToReadFile()) {
                                fulfilled_value.protect();
                                ctx.flags.response_protected = true;
                            }
                        },
                        .Locked => {
                            fulfilled_value.protect();
                            ctx.flags.response_protected = true;
                        },
                        else => {},
                    }
                    ctx.render(response);
                    return;
                },
                .rejected => |err| {
                    ctx.finishRunningErrorHandler(err, status);
                    return;
                },
            }
        }

        pub fn runErrorHandlerWithStatusCode(
            this: *RequestContext,
            value: JSC.JSValue,
            status: u16,
        ) void {
            JSC.markBinding(@src());
            if (this.resp == null or this.resp.?.hasResponded()) return;

            runErrorHandlerWithStatusCodeDontCheckResponded(this, value, status);
        }

        pub fn renderMetadata(this: *RequestContext) void {
            if (this.resp == null) return;
            const resp = this.resp.?;

            var response: *JSC.WebCore.Response = this.response_ptr.?;
            var status = response.statusCode();
            var needs_content_range = this.flags.needs_content_range and this.sendfile.remain < this.blob.size();

            const size = if (needs_content_range)
                this.sendfile.remain
            else
                this.blob.size();

            status = if (status == 200 and size == 0 and !this.blob.isDetached())
                204
            else
                status;

            const content_type, const needs_content_type, const content_type_needs_free = getContentType(
                response.init.headers,
                &this.blob,
                this.allocator,
            );
            defer if (content_type_needs_free) content_type.deinit(this.allocator);
            var has_content_disposition = false;
            var has_content_range = false;
            if (response.init.headers) |headers_| {
                has_content_disposition = headers_.fastHas(.ContentDisposition);
                has_content_range = headers_.fastHas(.ContentRange);
                needs_content_range = needs_content_range and has_content_range;
                if (needs_content_range) {
                    status = 206;
                }

                this.doWriteStatus(status);
                this.doWriteHeaders(headers_);
                response.init.headers = null;
                headers_.deref();
            } else if (needs_content_range) {
                status = 206;
                this.doWriteStatus(status);
            } else {
                this.doWriteStatus(status);
            }

            if (this.cookies) |cookies| {
                this.cookies = null;
                defer cookies.deref();
                cookies.write(this.server.?.globalThis, ssl_enabled, @ptrCast(this.resp.?));
            }

            if (needs_content_type and
                // do not insert the content type if it is the fallback value
                // we may not know the content-type when streaming
                (!this.blob.isDetached() or content_type.value.ptr != MimeType.other.value.ptr))
            {
                resp.writeHeader("content-type", content_type.value);
            }

            // automatically include the filename when:
            // 1. Bun.file("foo")
            // 2. The content-disposition header is not present
            if (!has_content_disposition and content_type.category.autosetFilename()) {
                if (this.blob.getFileName()) |filename| {
                    const basename = std.fs.path.basename(filename);
                    if (basename.len > 0) {
                        var filename_buf: [1024]u8 = undefined;

                        resp.writeHeader(
                            "content-disposition",
                            std.fmt.bufPrint(&filename_buf, "filename=\"{s}\"", .{basename[0..@min(basename.len, 1024 - 32)]}) catch "",
                        );
                    }
                }
            }

            if (this.flags.needs_content_length) {
                resp.writeHeaderInt("content-length", size);
                this.flags.needs_content_length = false;
            }

            if (needs_content_range and !has_content_range) {
                var content_range_buf: [1024]u8 = undefined;

                resp.writeHeader(
                    "content-range",
                    std.fmt.bufPrint(
                        &content_range_buf,
                        // we omit the full size of the Blob because it could
                        // change between requests and this potentially leaks
                        // PII undesirably
                        "bytes {d}-{d}/*",
                        .{ this.sendfile.offset, this.sendfile.offset + (this.sendfile.remain -| 1) },
                    ) catch "bytes */*",
                );
                this.flags.needs_content_range = false;
            }
        }

        fn doWriteStatus(this: *RequestContext, status: u16) void {
            assert(!this.flags.has_written_status);
            this.flags.has_written_status = true;

            writeStatus(ssl_enabled, this.resp, status);
        }

        fn doWriteHeaders(this: *RequestContext, headers: *JSC.FetchHeaders) void {
            writeHeaders(headers, ssl_enabled, this.resp);
        }

        pub fn renderBytes(this: *RequestContext) void {
            // copy it to stack memory to prevent aliasing issues in release builds
            const blob = this.blob;
            const bytes = blob.slice();
            if (this.resp) |resp| {
                if (!resp.tryEnd(
                    bytes,
                    bytes.len,
                    this.shouldCloseConnection(),
                )) {
                    this.flags.has_marked_pending = true;
                    resp.onWritable(*RequestContext, onWritableBytes, this);
                    return;
                }
            }
            this.detachResponse();
            this.endRequestStreamingAndDrain();
            this.deref();
        }

        pub fn render(this: *RequestContext, response: *JSC.WebCore.Response) void {
            ctxLog("render", .{});
            this.response_ptr = response;

            this.doRender();
        }

        pub fn onBufferedBodyChunk(this: *RequestContext, resp: *App.Response, chunk: []const u8, last: bool) void {
            ctxLog("onBufferedBodyChunk {} {}", .{ chunk.len, last });

            assert(this.resp == resp);

            this.flags.is_waiting_for_request_body = last == false;
            if (this.isAbortedOrEnded() or this.flags.has_marked_complete) return;
            if (!last and chunk.len == 0) {
                // Sometimes, we get back an empty chunk
                // We have to ignore those chunks unless it's the last one
                return;
            }
            const vm = this.server.?.vm;
            const globalThis = this.server.?.globalThis;

            // After the user does request.body,
            // if they then do .text(), .arrayBuffer(), etc
            // we can no longer hold the strong reference from the body value ref.
            if (this.request_body_readable_stream_ref.get(globalThis)) |readable| {
                assert(this.request_body_buf.items.len == 0);
                vm.eventLoop().enter();
                defer vm.eventLoop().exit();

                if (!last) {
                    readable.ptr.Bytes.onData(
                        .{
                            .temporary = bun.ByteList.initConst(chunk),
                        },
                        bun.default_allocator,
                    );
                } else {
                    var strong = this.request_body_readable_stream_ref;
                    this.request_body_readable_stream_ref = .{};
                    defer strong.deinit();
                    if (this.request_body) |request_body| {
                        _ = request_body.unref();
                        this.request_body = null;
                    }

                    readable.value.ensureStillAlive();
                    readable.ptr.Bytes.onData(
                        .{
                            .temporary_and_done = bun.ByteList.initConst(chunk),
                        },
                        bun.default_allocator,
                    );
                }

                return;
            }

            // This is the start of a task, so it's a good time to drain
            if (this.request_body != null) {
                var body = this.request_body.?;

                if (last) {
                    var bytes = &this.request_body_buf;

                    var old = body.value;

                    const total = bytes.items.len + chunk.len;
                    getter: {
                        // if (total <= JSC.WebCore.InlineBlob.available_bytes) {
                        //     if (total == 0) {
                        //         body.value = .{ .Empty = {} };
                        //         break :getter;
                        //     }

                        //     body.value = .{ .InlineBlob = JSC.WebCore.InlineBlob.concat(bytes.items, chunk) };
                        //     this.request_body_buf.clearAndFree(this.allocator);
                        // } else {
                        bytes.ensureTotalCapacityPrecise(this.allocator, total) catch |err| {
                            this.request_body_buf.clearAndFree(this.allocator);
                            body.value.toError(err, globalThis);
                            break :getter;
                        };

                        const prev_len = bytes.items.len;
                        bytes.items.len = total;
                        var slice = bytes.items[prev_len..];
                        @memcpy(slice[0..chunk.len], chunk);
                        body.value = .{
                            .InternalBlob = .{
                                .bytes = bytes.toManaged(this.allocator),
                            },
                        };
                        // }
                    }
                    this.request_body_buf = .{};

                    if (old == .Locked) {
                        var loop = vm.eventLoop();
                        loop.enter();
                        defer loop.exit();

                        old.resolve(&body.value, globalThis, null);
                    }
                    return;
                }

                if (this.request_body_buf.capacity == 0) {
                    this.request_body_buf.ensureTotalCapacityPrecise(this.allocator, @min(this.request_body_content_len, max_request_body_preallocate_length)) catch @panic("Out of memory while allocating request body buffer");
                }
                this.request_body_buf.appendSlice(this.allocator, chunk) catch @panic("Out of memory while allocating request body");
            }
        }

        pub fn onStartStreamingRequestBody(this: *RequestContext) JSC.WebCore.DrainResult {
            ctxLog("onStartStreamingRequestBody", .{});
            if (this.isAbortedOrEnded()) {
                return JSC.WebCore.DrainResult{
                    .aborted = {},
                };
            }

            // This means we have received part of the body but not the whole thing
            if (this.request_body_buf.items.len > 0) {
                var emptied = this.request_body_buf;
                this.request_body_buf = .{};
                return .{
                    .owned = .{
                        .list = emptied.toManaged(this.allocator),
                        .size_hint = if (emptied.capacity < max_request_body_preallocate_length)
                            emptied.capacity
                        else
                            0,
                    },
                };
            }

            return .{
                .estimated_size = this.request_body_content_len,
            };
        }
        const max_request_body_preallocate_length = 1024 * 256;
        pub fn onStartBuffering(this: *RequestContext) void {
            if (this.server) |server| {
                ctxLog("onStartBuffering", .{});
                // TODO: check if is someone calling onStartBuffering other than onStartBufferingCallback
                // if is not, this should be removed and only keep protect + setAbortHandler
                if (this.flags.is_transfer_encoding == false and this.request_body_content_len == 0) {
                    // no content-length or 0 content-length
                    // no transfer-encoding
                    if (this.request_body != null) {
                        var body = this.request_body.?;
                        var old = body.value;
                        old.Locked.onReceiveValue = null;
                        var new_body: WebCore.Body.Value = .{ .Null = {} };
                        old.resolve(&new_body, server.globalThis, null);
                        body.value = new_body;
                    }
                }
            }
        }

        pub fn onRequestBodyReadableStreamAvailable(ptr: *anyopaque, globalThis: *JSC.JSGlobalObject, readable: JSC.WebCore.ReadableStream) void {
            var this = bun.cast(*RequestContext, ptr);
            bun.debugAssert(this.request_body_readable_stream_ref.held.impl == null);
            this.request_body_readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(readable, globalThis);
        }

        pub fn onStartBufferingCallback(this: *anyopaque) void {
            onStartBuffering(bun.cast(*RequestContext, this));
        }

        pub fn onStartStreamingRequestBodyCallback(this: *anyopaque) JSC.WebCore.DrainResult {
            return onStartStreamingRequestBody(bun.cast(*RequestContext, this));
        }

        pub fn getRemoteSocketInfo(this: *RequestContext) ?uws.SocketAddress {
            return (this.resp orelse return null).getRemoteSocketInfo();
        }

        pub fn setTimeout(this: *RequestContext, seconds: c_uint) bool {
            if (this.resp) |resp| {
                resp.timeout(@min(seconds, 255));
                if (seconds > 0) {

                    // we only set the timeout callback if we wanna the timeout event to be triggered
                    // the connection will be closed so the abort handler will be called after the timeout
                    if (this.request_weakref.get()) |req| {
                        if (req.internal_event_callback.hasCallback()) {
                            this.setTimeoutHandler();
                        }
                    }
                } else {
                    // if the timeout is 0, we don't need to trigger the timeout event
                    resp.clearTimeout();
                }
                return true;
            }
            return false;
        }

        comptime {
            const export_prefix = "Bun__HTTPRequestContext" ++ (if (debug_mode) "Debug" else "") ++ (if (ThisServer.ssl_enabled) "TLS" else "");
            const jsonResolve = JSC.toJSHostFunction(onResolve);
            @export(&jsonResolve, .{ .name = export_prefix ++ "__onResolve" });
            const jsonReject = JSC.toJSHostFunction(onReject);
            @export(&jsonReject, .{ .name = export_prefix ++ "__onReject" });
            const jsonResolveStream = JSC.toJSHostFunction(onResolveStream);
            @export(&jsonResolveStream, .{ .name = export_prefix ++ "__onResolveStream" });
            const jsonRejectStream = JSC.toJSHostFunction(onRejectStream);
            @export(&jsonRejectStream, .{ .name = export_prefix ++ "__onRejectStream" });
        }
    };
}

pub const WebSocketServer = struct {
    globalObject: *JSC.JSGlobalObject = undefined,
    handler: WebSocketServer.Handler = .{},

    maxPayloadLength: u32 = 1024 * 1024 * 16, // 16MB
    maxLifetime: u16 = 0,
    idleTimeout: u16 = 120, // 2 minutes
    compression: i32 = 0,
    backpressureLimit: u32 = 1024 * 1024 * 16, // 16MB
    sendPingsAutomatically: bool = true,
    resetIdleTimeoutOnSend: bool = true,
    closeOnBackpressureLimit: bool = false,

    pub const Handler = struct {
        onOpen: JSC.JSValue = .zero,
        onMessage: JSC.JSValue = .zero,
        onClose: JSC.JSValue = .zero,
        onDrain: JSC.JSValue = .zero,
        onError: JSC.JSValue = .zero,
        onPing: JSC.JSValue = .zero,
        onPong: JSC.JSValue = .zero,

        app: ?*anyopaque = null,

        // Always set manually.
        vm: *JSC.VirtualMachine = undefined,
        globalObject: *JSC.JSGlobalObject = undefined,
        active_connections: usize = 0,

        /// used by publish()
        flags: packed struct(u2) {
            ssl: bool = false,
            publish_to_self: bool = false,
        } = .{},

        pub fn runErrorCallback(this: *const Handler, vm: *JSC.VirtualMachine, globalObject: *JSC.JSGlobalObject, error_value: JSC.JSValue) void {
            const onError = this.onError;
            if (!onError.isEmptyOrUndefinedOrNull()) {
                _ = onError.call(globalObject, .undefined, &.{error_value}) catch |err|
                    this.globalObject.reportActiveExceptionAsUnhandled(err);
                return;
            }

            _ = vm.uncaughtException(globalObject, error_value, false);
        }

        pub fn fromJS(globalObject: *JSC.JSGlobalObject, object: JSC.JSValue) bun.JSError!Handler {
            var handler = Handler{ .globalObject = globalObject, .vm = VirtualMachine.get() };

            var valid = false;

            if (try object.getTruthyComptime(globalObject, "message")) |message_| {
                if (!message_.isCallable()) {
                    return globalObject.throwInvalidArguments("websocket expects a function for the message option", .{});
                }
                const message = message_.withAsyncContextIfNeeded(globalObject);
                handler.onMessage = message;
                message.ensureStillAlive();
                valid = true;
            }

            if (try object.getTruthy(globalObject, "open")) |open_| {
                if (!open_.isCallable()) {
                    return globalObject.throwInvalidArguments("websocket expects a function for the open option", .{});
                }
                const open = open_.withAsyncContextIfNeeded(globalObject);
                handler.onOpen = open;
                open.ensureStillAlive();
                valid = true;
            }

            if (try object.getTruthy(globalObject, "close")) |close_| {
                if (!close_.isCallable()) {
                    return globalObject.throwInvalidArguments("websocket expects a function for the close option", .{});
                }
                const close = close_.withAsyncContextIfNeeded(globalObject);
                handler.onClose = close;
                close.ensureStillAlive();
                valid = true;
            }

            if (try object.getTruthy(globalObject, "drain")) |drain_| {
                if (!drain_.isCallable()) {
                    return globalObject.throwInvalidArguments("websocket expects a function for the drain option", .{});
                }
                const drain = drain_.withAsyncContextIfNeeded(globalObject);
                handler.onDrain = drain;
                drain.ensureStillAlive();
                valid = true;
            }

            if (try object.getTruthy(globalObject, "onError")) |onError_| {
                if (!onError_.isCallable()) {
                    return globalObject.throwInvalidArguments("websocket expects a function for the onError option", .{});
                }
                const onError = onError_.withAsyncContextIfNeeded(globalObject);
                handler.onError = onError;
                onError.ensureStillAlive();
            }

            if (try object.getTruthy(globalObject, "ping")) |cb| {
                if (!cb.isCallable()) {
                    return globalObject.throwInvalidArguments("websocket expects a function for the ping option", .{});
                }
                handler.onPing = cb;
                cb.ensureStillAlive();
                valid = true;
            }

            if (try object.getTruthy(globalObject, "pong")) |cb| {
                if (!cb.isCallable()) {
                    return globalObject.throwInvalidArguments("websocket expects a function for the pong option", .{});
                }
                handler.onPong = cb;
                cb.ensureStillAlive();
                valid = true;
            }

            if (valid)
                return handler;

            return globalObject.throwInvalidArguments("WebSocketServer expects a message handler", .{});
        }

        pub fn protect(this: Handler) void {
            this.onOpen.protect();
            this.onMessage.protect();
            this.onClose.protect();
            this.onDrain.protect();
            this.onError.protect();
            this.onPing.protect();
            this.onPong.protect();
        }

        pub fn unprotect(this: Handler) void {
            if (this.vm.isShuttingDown()) {
                return;
            }

            this.onOpen.unprotect();
            this.onMessage.unprotect();
            this.onClose.unprotect();
            this.onDrain.unprotect();
            this.onError.unprotect();
            this.onPing.unprotect();
            this.onPong.unprotect();
        }
    };

    pub fn toBehavior(this: WebSocketServer) uws.WebSocketBehavior {
        return .{
            .maxPayloadLength = this.maxPayloadLength,
            .idleTimeout = this.idleTimeout,
            .compression = this.compression,
            .maxBackpressure = this.backpressureLimit,
            .sendPingsAutomatically = this.sendPingsAutomatically,
            .maxLifetime = this.maxLifetime,
            .resetIdleTimeoutOnSend = this.resetIdleTimeoutOnSend,
            .closeOnBackpressureLimit = this.closeOnBackpressureLimit,
        };
    }

    pub fn protect(this: WebSocketServer) void {
        this.handler.protect();
    }
    pub fn unprotect(this: WebSocketServer) void {
        this.handler.unprotect();
    }

    const CompressTable = bun.ComptimeStringMap(i32, .{
        .{ "disable", 0 },
        .{ "shared", uws.SHARED_COMPRESSOR },
        .{ "dedicated", uws.DEDICATED_COMPRESSOR },
        .{ "3KB", uws.DEDICATED_COMPRESSOR_3KB },
        .{ "4KB", uws.DEDICATED_COMPRESSOR_4KB },
        .{ "8KB", uws.DEDICATED_COMPRESSOR_8KB },
        .{ "16KB", uws.DEDICATED_COMPRESSOR_16KB },
        .{ "32KB", uws.DEDICATED_COMPRESSOR_32KB },
        .{ "64KB", uws.DEDICATED_COMPRESSOR_64KB },
        .{ "128KB", uws.DEDICATED_COMPRESSOR_128KB },
        .{ "256KB", uws.DEDICATED_COMPRESSOR_256KB },
    });

    const DecompressTable = bun.ComptimeStringMap(i32, .{
        .{ "disable", 0 },
        .{ "shared", uws.SHARED_DECOMPRESSOR },
        .{ "dedicated", uws.DEDICATED_DECOMPRESSOR },
        .{ "3KB", uws.DEDICATED_COMPRESSOR_3KB },
        .{ "4KB", uws.DEDICATED_COMPRESSOR_4KB },
        .{ "8KB", uws.DEDICATED_COMPRESSOR_8KB },
        .{ "16KB", uws.DEDICATED_COMPRESSOR_16KB },
        .{ "32KB", uws.DEDICATED_COMPRESSOR_32KB },
        .{ "64KB", uws.DEDICATED_COMPRESSOR_64KB },
        .{ "128KB", uws.DEDICATED_COMPRESSOR_128KB },
        .{ "256KB", uws.DEDICATED_COMPRESSOR_256KB },
    });

    pub fn onCreate(globalObject: *JSC.JSGlobalObject, object: JSValue) bun.JSError!WebSocketServer {
        var server = WebSocketServer{};
        server.handler = try Handler.fromJS(globalObject, object);

        if (try object.get(globalObject, "perMessageDeflate")) |per_message_deflate| {
            getter: {
                if (per_message_deflate.isUndefined()) {
                    break :getter;
                }

                if (per_message_deflate.isBoolean() or per_message_deflate.isNull()) {
                    if (per_message_deflate.toBoolean()) {
                        server.compression = uws.SHARED_COMPRESSOR | uws.SHARED_DECOMPRESSOR;
                    } else {
                        server.compression = 0;
                    }
                    break :getter;
                }

                if (try per_message_deflate.getTruthy(globalObject, "compress")) |compression| {
                    if (compression.isBoolean()) {
                        server.compression |= if (compression.toBoolean()) uws.SHARED_COMPRESSOR else 0;
                    } else if (compression.isString()) {
                        server.compression |= CompressTable.getWithEql(try compression.getZigString(globalObject), ZigString.eqlComptime) orelse {
                            return globalObject.throwInvalidArguments("WebSocketServer expects a valid compress option, either disable \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"", .{});
                        };
                    } else {
                        return globalObject.throwInvalidArguments("websocket expects a valid compress option, either disable \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"", .{});
                    }
                }

                if (try per_message_deflate.getTruthy(globalObject, "decompress")) |compression| {
                    if (compression.isBoolean()) {
                        server.compression |= if (compression.toBoolean()) uws.SHARED_DECOMPRESSOR else 0;
                    } else if (compression.isString()) {
                        server.compression |= DecompressTable.getWithEql(try compression.getZigString(globalObject), ZigString.eqlComptime) orelse {
                            return globalObject.throwInvalidArguments("websocket expects a valid decompress option, either \"disable\" \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"", .{});
                        };
                    } else {
                        return globalObject.throwInvalidArguments("websocket expects a valid decompress option, either \"disable\" \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"", .{});
                    }
                }
            }
        }

        if (try object.get(globalObject, "maxPayloadLength")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isAnyInt()) {
                    return globalObject.throwInvalidArguments("websocket expects maxPayloadLength to be an integer", .{});
                }
                server.maxPayloadLength = @truncate(@max(value.toInt64(), 0));
            }
        }

        if (try object.get(globalObject, "idleTimeout")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isAnyInt()) {
                    return globalObject.throwInvalidArguments("websocket expects idleTimeout to be an integer", .{});
                }

                var idleTimeout: u16 = @truncate(@max(value.toInt64(), 0));
                if (idleTimeout > 960) {
                    return globalObject.throwInvalidArguments("websocket expects idleTimeout to be 960 or less", .{});
                } else if (idleTimeout > 0) {
                    // uws does not allow idleTimeout to be between (0, 8),
                    // since its timer is not that accurate, therefore round up.
                    idleTimeout = @max(idleTimeout, 8);
                }

                server.idleTimeout = idleTimeout;
            }
        }
        if (try object.get(globalObject, "backpressureLimit")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isAnyInt()) {
                    return globalObject.throwInvalidArguments("websocket expects backpressureLimit to be an integer", .{});
                }

                server.backpressureLimit = @truncate(@max(value.toInt64(), 0));
            }
        }

        if (try object.get(globalObject, "closeOnBackpressureLimit")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isBoolean()) {
                    return globalObject.throwInvalidArguments("websocket expects closeOnBackpressureLimit to be a boolean", .{});
                }

                server.closeOnBackpressureLimit = value.toBoolean();
            }
        }

        if (try object.get(globalObject, "sendPings")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isBoolean()) {
                    return globalObject.throwInvalidArguments("websocket expects sendPings to be a boolean", .{});
                }

                server.sendPingsAutomatically = value.toBoolean();
            }
        }

        if (try object.get(globalObject, "publishToSelf")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isBoolean()) {
                    return globalObject.throwInvalidArguments("websocket expects publishToSelf to be a boolean", .{});
                }

                server.handler.flags.publish_to_self = value.toBoolean();
            }
        }

        server.protect();
        return server;
    }
};

pub const ServerWebSocket = @import("./server/ServerWebSocket.zig");
pub const NodeHTTPResponse = @import("./server/NodeHTTPResponse.zig");

/// State machine to handle loading plugins asynchronously. This structure is not thread-safe.
const ServePlugins = struct {
    state: State,
    ref_count: u32 = 1,

    /// Reference count is incremented while there are other objects that are waiting on plugin loads.
    pub usingnamespace bun.NewRefCounted(ServePlugins, deinit, null);

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
        return ServePlugins.new(.{ .state = .{ .unqueued = plugins } });
    }

    pub fn deinit(this: *ServePlugins) void {
        switch (this.state) {
            .unqueued => {},
            .pending => assert(false), // should have one ref while pending!
            .loaded => |loaded| loaded.deinit(),
            .err => {},
        }
        this.destroy();
    }

    pub fn getOrStartLoad(this: *ServePlugins, global: *JSC.JSGlobalObject, cb: Callback) bun.OOM!GetOrStartLoadResult {
        sw: switch (this.state) {
            .unqueued => {
                this.loadAndResolvePlugins(global);
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

    fn loadAndResolvePlugins(this: *ServePlugins, global: *JSC.JSGlobalObject) void {
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
        const plugin_js_array = bun.String.toJSArray(global, bunstring_array);
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
                        this.state.pending.promise.strong.set(global, promise.asValue(global));
                        promise.asValue(global).then(global, this, onResolveImpl, onRejectImpl);
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

    pub const onResolve = JSC.toJSHostFunction(onResolveImpl);
    pub const onReject = JSC.toJSHostFunction(onRejectImpl);

    pub fn onResolveImpl(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        ctxLog("onResolve", .{});

        const plugins_result, const plugins_js = callframe.argumentsAsArray(2);
        var plugins = plugins_js.asPromisePtr(ServePlugins);
        defer plugins.deref();
        plugins_result.ensureStillAlive();

        handleOnResolve(plugins);

        return JSValue.jsUndefined();
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

        return JSValue.jsUndefined();
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

pub fn NewServer(comptime NamespaceType: type, comptime ssl_enabled_: bool, comptime debug_mode_: bool) type {
    return struct {
        pub usingnamespace NamespaceType;
        pub usingnamespace bun.New(@This());

        pub const ssl_enabled = ssl_enabled_;
        pub const debug_mode = debug_mode_;

        const ThisServer = @This();
        pub const RequestContext = NewRequestContext(ssl_enabled, debug_mode, @This());

        pub const App = uws.NewApp(ssl_enabled);

        listener: ?*App.ListenSocket = null,
        js_value: JSC.Strong = .empty,
        /// Potentially null before listen() is called, and once .destroy() is called.
        app: ?*App = null,
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

        pub const doStop = JSC.wrapInstanceMethod(ThisServer, "stopFromJS", false);
        pub const dispose = JSC.wrapInstanceMethod(ThisServer, "disposeFromJS", false);
        pub const doUpgrade = JSC.wrapInstanceMethod(ThisServer, "onUpgrade", false);
        pub const doPublish = JSC.wrapInstanceMethod(ThisServer, "publish", false);
        pub const doReload = onReload;
        pub const doFetch = onFetch;
        pub const doRequestIP = JSC.wrapInstanceMethod(ThisServer, "requestIP", false);
        pub const doTimeout = timeout;

        const UserRoute = struct {
            id: u32,
            server: *ThisServer,
            route: UserRouteBuilder.RouteDeclaration,

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
                break :brk .undefined; // safe-ish
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

            return JSValue.jsUndefined();
        }

        pub fn setIdleTimeout(this: *ThisServer, seconds: c_uint) void {
            this.config.idleTimeout = @truncate(@min(seconds, 255));
        }

        pub fn appendStaticRoute(this: *ThisServer, path: []const u8, route: AnyRoute) !void {
            try this.config.appendStaticRoute(path, route);
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
                var fetch_headers_to_deref: ?*JSC.FetchHeaders = null;

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

                        if (opts.fastGet(globalThis, .data)) |headers_value| {
                            data_value = headers_value;
                        }

                        if (globalThis.hasException()) {
                            return error.JSError;
                        }

                        if (opts.fastGet(globalThis, .headers)) |headers_value| {
                            if (headers_value.isEmptyOrUndefinedOrNull()) {
                                break :getter;
                            }

                            var fetch_headers_to_use: *JSC.FetchHeaders = headers_value.as(JSC.FetchHeaders) orelse brk: {
                                if (headers_value.isObject()) {
                                    if (JSC.FetchHeaders.createFromJS(globalThis, headers_value)) |fetch_headers| {
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
            var fetch_headers_to_deref: ?*JSC.FetchHeaders = null;

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

                    if (opts.fastGet(globalThis, .data)) |headers_value| {
                        data_value = headers_value;
                    }

                    if (globalThis.hasException()) {
                        return error.JSError;
                    }

                    if (opts.fastGet(globalThis, .headers)) |headers_value| {
                        if (headers_value.isEmptyOrUndefinedOrNull()) {
                            break :getter;
                        }

                        var fetch_headers_to_use: *JSC.FetchHeaders = headers_value.as(JSC.FetchHeaders) orelse brk: {
                            if (headers_value.isObject()) {
                                if (JSC.FetchHeaders.createFromJS(globalThis, headers_value)) |fetch_headers| {
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
            upgrader.upgrade_context = @as(*uws.uws_socket_context_s, @ptrFromInt(std.math.maxInt(usize)));
            const signal = upgrader.signal;

            upgrader.signal = null;
            upgrader.resp = null;
            request.request_context = AnyRequestContext.Null;
            upgrader.request_weakref.deinit();

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
            if (this.config.onRequest != new_config.onRequest and (new_config.onRequest != .zero and new_config.onRequest != .undefined)) {
                this.config.onRequest.unprotect();
                this.config.onRequest = new_config.onRequest;
            }
            if (this.config.onNodeHTTPRequest != new_config.onNodeHTTPRequest) {
                this.config.onNodeHTTPRequest.unprotect();
                this.config.onNodeHTTPRequest = new_config.onNodeHTTPRequest;
            }
            if (this.config.onError != new_config.onError and (new_config.onError != .zero and new_config.onError != .undefined)) {
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
                    NamespaceType.routeListSetCached(server_js_value, this.globalThis, route_list_value);
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
                    NamespaceType.routeListSetCached(server_js_value, this.globalThis, route_list_value);
                }
            }
            return true;
        }

        pub fn onReload(this: *ThisServer, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments = callframe.arguments();
            if (arguments.len < 1) {
                return globalThis.throwNotEnoughArguments("reload", 1, 0);
            }

            var args_slice = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
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

            return this.js_value.get() orelse .undefined;
        }

        pub fn onFetch(
            this: *ThisServer,
            ctx: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());

            if (this.config.onRequest == .zero) {
                return JSPromise.rejectedPromiseValue(ctx, ZigString.init("fetch() requires the server to have a fetch handler").toErrorInstance(ctx));
            }

            const arguments = callframe.arguments_old(2).slice();
            if (arguments.len == 0) {
                const fetch_error = WebCore.Fetch.fetch_error_no_args;
                return JSPromise.rejectedPromiseValue(ctx, ZigString.init(fetch_error).toErrorInstance(ctx));
            }

            var headers: ?*JSC.FetchHeaders = null;
            var method = HTTP.Method.GET;
            var args = JSC.Node.ArgumentsSlice.init(ctx.bunVM(), arguments);
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
                    return JSPromise.rejectedPromiseValue(ctx, ZigString.init(fetch_error).toErrorInstance(ctx));
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
                    if (opts.fastGet(ctx, .method)) |method_| {
                        var slice_ = try method_.toSlice(ctx, getAllocator(ctx));
                        defer slice_.deinit();
                        method = HTTP.Method.which(slice_.slice()) orelse method;
                    }

                    if (opts.fastGet(ctx, .headers)) |headers_| {
                        if (headers_.as(JSC.FetchHeaders)) |headers__| {
                            headers = headers__;
                        } else if (JSC.FetchHeaders.createFromJS(ctx, headers_)) |headers__| {
                            headers = headers__;
                        }
                    }

                    if (opts.fastGet(ctx, .body)) |body__| {
                        if (Blob.get(ctx, body__, true, false)) |new_blob| {
                            body = .{ .Blob = new_blob };
                        } else |_| {
                            return JSPromise.rejectedPromiseValue(ctx, ZigString.init("fetch() received invalid body").toErrorInstance(ctx));
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
                const fetch_error = JSC.WebCore.Fetch.fetch_type_error_strings.get(js.JSValueGetType(ctx, first_arg.asRef()));
                const err = JSC.toTypeError(.ERR_INVALID_ARG_TYPE, "{s}", .{fetch_error}, ctx);

                return JSPromise.rejectedPromiseValue(ctx, err);
            }

            var request = Request.new(existing_request);

            bun.assert(this.config.onRequest != .zero); // confirmed above
            const response_value = this.config.onRequest.call(
                this.globalThis,
                this.jsValueAssertAlive(),
                &[_]JSC.JSValue{request.toJS(this.globalThis)},
            ) catch |err| this.globalThis.takeException(err);

            if (response_value.isAnyError()) {
                return JSC.JSPromise.rejectedPromiseValue(ctx, response_value);
            }

            if (response_value.isEmptyOrUndefinedOrNull()) {
                return JSC.JSPromise.rejectedPromiseValue(ctx, ZigString.init("fetch() returned an empty value").toErrorInstance(ctx));
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

            return .undefined;
        }

        pub fn getPort(
            this: *ThisServer,
            _: *JSC.JSGlobalObject,
        ) JSC.JSValue {
            switch (this.config.address) {
                .unix => return .undefined,
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

        pub fn getURL(this: *ThisServer, globalThis: *JSGlobalObject) JSC.JSValue {
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
                        .proto = if (comptime ssl_enabled_) .https else .http,
                        .hostname = if (tcp.hostname) |hostname| bun.sliceTo(@constCast(hostname), 0) else null,
                        .port = port,
                    };
                },
            };

            const buf = std.fmt.allocPrint(default_allocator, "{any}", .{fmt}) catch bun.outOfMemory();
            defer default_allocator.free(buf);

            var value = bun.String.createUTF8(buf);
            defer value.deref();
            return value.toJSDOMURL(globalThis);
        }

        pub fn getHostname(this: *ThisServer, globalThis: *JSGlobalObject) JSC.JSValue {
            switch (this.config.address) {
                .unix => return .undefined,
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
                return JSC.JSPromise.resolvedPromise(globalThis, .undefined).asValue(globalThis);
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
                        .strong = JSC.Strong.create(this.all_closed_promise.value(), this.globalThis),
                    },
                    .tracker = JSC.AsyncTaskTracker.init(vm),
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

            if (!ssl_enabled_)
                this.vm.removeListeningSocketForWatchMode(listener.socket().fd());

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

        pub fn deinit(this: *ThisServer) void {
            httplog("deinit", .{});
            this.cached_hostname.deref();
            this.all_closed_promise.deinit();
            for (this.user_routes.items) |*user_route| {
                user_route.deinit();
            }
            this.user_routes.deinit(bun.default_allocator);

            this.config.deinit();
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

            this.destroy();
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

            if (comptime ssl_enabled_) {
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
                                if (code == bun.C.E.ACCES) {
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
            if (!ssl_enabled_)
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

            const buffer_writer = js_printer.BufferWriter.init(allocator) catch unreachable;
            var writer = js_printer.BufferPrinter.init(buffer_writer);
            defer writer.ctx.buffer.deinit();
            var source = logger.Source.initEmptyFile("info.json");
            _ = js_printer.printJSON(
                *js_printer.BufferPrinter,
                &writer,
                bun.Global.BunInfo.generate(*Transpiler, &JSC.VirtualMachine.get().transpiler, allocator) catch unreachable,
                &source,
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

        pub fn onNodeHTTPRequestWithUpgradeCtx(this: *ThisServer, req: *uws.Request, resp: *App.Response, upgrade_ctx: ?*uws.uws_socket_context_t) void {
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
            const thisObject = this.js_value.get() orelse .undefined;
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
            var strong_promise: JSC.Strong = .empty;
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
            var prepared = server.prepareJsRequestContext(req, resp, &should_deinit_context, false) orelse return;

            const server_request_list = NamespaceType.routeListGetCached(server.jsValueAssertAlive()).?;
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

        pub fn onRequest(this: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            var should_deinit_context = false;
            const prepared = this.prepareJsRequestContext(req, resp, &should_deinit_context, true) orelse return;

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
                .stack => |r| this.prepareJsRequestContext(r, resp, null, true) orelse return,
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
                    .js_request = JSC.Strong.create(prepared.js_request, global),
                    .request = prepared.request_object,
                    .ctx = AnyRequestContext.init(prepared.ctx),
                    .response = uws.AnyResponse.init(resp),
                };
            }
        };

        pub fn prepareJsRequestContext(this: *ThisServer, req: *uws.Request, resp: *App.Response, should_deinit_context: ?*bool, create_js_request: bool) ?PreparedRequest {
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
            ctx.create(this, req, resp, should_deinit_context);
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
            ctx.request_weakref = Request.WeakRef.create(request_object);

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

        fn upgradeWebSocketUserRoute(this: *UserRoute, resp: *App.Response, req: *uws.Request, upgrade_ctx: *uws.uws_socket_context_t) void {
            const server = this.server;
            const index = this.id;

            var should_deinit_context = false;
            var prepared = server.prepareJsRequestContext(req, resp, &should_deinit_context, false) orelse return;
            prepared.ctx.upgrade_context = upgrade_ctx; // set the upgrade context
            const server_request_list = NamespaceType.routeListGetCached(server.jsValueAssertAlive()).?;
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
            upgrade_ctx: *uws.uws_socket_context_t,
            id: usize,
        ) void {
            JSC.markBinding(@src());
            if (id == 1) {
                // This is actually a UserRoute if id is 1 so it's safe to cast
                upgradeWebSocketUserRoute(@ptrCast(this), resp, req, upgrade_ctx);
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
            ctx.create(this, req, resp, &should_deinit_context);
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
            ctx.request_weakref = Request.WeakRef.create(request_object);
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

        fn setRoutes(this: *ThisServer) JSC.JSValue {
            var route_list_value = JSC.JSValue.zero;
            // TODO: move devserver and plugin logic away
            const app = this.app.?;
            const any_server = AnyServer.from(this);
            const dev_server = this.dev_server;

            // Plugins need to be registered if any of the following are
            // assigned. This is done in `setRoutes` so that reloading
            // a server can initialize such state.
            // - DevServer
            // - HTML Bundle
            var needs_plugins = dev_server != null;

            if (this.config.user_routes_to_build.items.len > 0) {
                var user_routes_to_build = this.config.user_routes_to_build.moveToUnmanaged();
                var old_user_routes = this.user_routes;

                defer {
                    for (old_user_routes.items) |*route| {
                        route.route.deinit();
                    }

                    old_user_routes.deinit(bun.default_allocator);
                }
                this.user_routes = std.ArrayListUnmanaged(UserRoute).initCapacity(bun.default_allocator, user_routes_to_build.items.len) catch bun.outOfMemory();
                const paths = bun.default_allocator.alloc(ZigString, user_routes_to_build.items.len) catch bun.outOfMemory();
                const callbacks = bun.default_allocator.alloc(JSC.JSValue, user_routes_to_build.items.len) catch bun.outOfMemory();
                defer bun.default_allocator.free(paths);
                defer bun.default_allocator.free(callbacks);

                for (user_routes_to_build.items, paths, callbacks, 0..) |*route, *path, *callback, i| {
                    path.* = ZigString.init(route.route.path);
                    callback.* = route.callback.get().?;
                    this.user_routes.appendAssumeCapacity(.{
                        .id = @truncate(i),
                        .server = this,
                        .route = route.route,
                    });
                    route.route = .{};
                }

                route_list_value = Bun__ServerRouteList__create(this.globalThis, callbacks.ptr, paths.ptr, user_routes_to_build.items.len);

                for (user_routes_to_build.items) |*route| {
                    route.deinit();
                }
                user_routes_to_build.deinit(bun.default_allocator);
            }
            var has_any_ws = false;
            if (this.config.websocket) |*websocket| {
                websocket.globalObject = this.globalThis;
                websocket.handler.app = app;
                websocket.handler.flags.ssl = ssl_enabled;
            }

            // This may get applied multiple times.
            for (this.user_routes.items) |*user_route| {
                switch (user_route.route.method) {
                    .any => {
                        app.any(user_route.route.path, *UserRoute, user_route, onUserRouteRequest);

                        if (this.config.websocket) |*websocket| {
                            // Setup user websocket in the route if needed.
                            if (!has_any_ws) {
                                // mark if the route is a catch-all so we dont override it
                                has_any_ws = strings.eqlComptime(user_route.route.path, "/*");
                            }
                            app.ws(
                                user_route.route.path,
                                user_route,
                                1, // id 1 means is a user route
                                ServerWebSocket.behavior(ThisServer, ssl_enabled, websocket.toBehavior()),
                            );
                        }
                    },
                    .specific => |method| {
                        app.method(method, user_route.route.path, *UserRoute, user_route, onUserRouteRequest);
                        // Setup user websocket in the route if needed.
                        if (this.config.websocket) |*websocket| {
                            // Websocket upgrade is a GET request
                            if (method == HTTP.Method.GET) {
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

            // negative routes have backwards precedence.
            for (this.config.negative_routes.items) |route| {
                // Since .applyStaticRoute does head, we need to do it first here too.
                app.head(route, *ThisServer, this, onRequest);

                app.any(route, *ThisServer, this, onRequest);
            }

            if (this.config.static_routes.items.len > 0) {
                for (this.config.static_routes.items) |*entry| {
                    switch (entry.route) {
                        .static => |static_route| {
                            ServerConfig.applyStaticRoute(any_server, ssl_enabled, app, *StaticRoute, static_route, entry.path);
                        },
                        .html => |html_bundle_route| {
                            ServerConfig.applyStaticRoute(any_server, ssl_enabled, app, *HTMLBundle.Route, html_bundle_route, entry.path);
                            if (dev_server) |dev| {
                                dev.html_router.put(dev.allocator, entry.path, html_bundle_route) catch bun.outOfMemory();
                            }
                            needs_plugins = true;
                        },
                        .framework_router => {},
                    }
                }
            }

            // If there are plugins, initialize the ServePlugins object in
            // an unqueued state. The first thing (HTML Bundle, DevServer)
            // that needs plugins will cause the load to happen.
            if (needs_plugins and this.plugins == null) if (this.vm.transpiler.options.serve_plugins) |serve_plugins| {
                if (serve_plugins.len > 0) {
                    this.plugins = ServePlugins.init(serve_plugins);
                }
            };

            const @"has /*" = for (this.config.static_routes.items) |route| {
                if (strings.eqlComptime(route.path, "/*")) break true;
            } else for (this.user_routes.items) |route| {
                if (strings.eqlComptime(route.route.path, "/*")) break true;
            } else false;

            // Setup user websocket fallback route aka fetch function if fetch is not provided will respond with 403.
            if (!has_any_ws) {
                if (this.config.websocket) |*websocket| {
                    app.ws(
                        "/*",
                        this,
                        0, // id 0 means is a fallback route and ctx is the server
                        ServerWebSocket.behavior(ThisServer, ssl_enabled, websocket.toBehavior()),
                    );
                }
            }
            if (this.config.onNodeHTTPRequest != .zero) {
                app.any("/*", *ThisServer, this, onNodeHTTPRequest);
                NodeHTTP_assignOnCloseFunction(ssl_enabled, app);
            } else if (this.config.onRequest != .zero and !@"has /*") {
                app.any("/*", *ThisServer, this, onRequest);
            }

            if (debug_mode) {
                app.get("/bun:info", *ThisServer, this, onBunInfoRequest);
                if (this.config.inspector) {
                    JSC.markBinding(@src());
                    Bun__addInspector(ssl_enabled, app, this.globalThis);
                }
            }

            var has_dev_catch_all = false;
            if (dev_server) |dev| {
                // DevServer adds a catch-all handler to use FrameworkRouter (full stack apps)
                has_dev_catch_all = dev.setRoutes(this) catch bun.outOfMemory();
            }

            // "/*" routes are added backwards, so if they have a static route, it will never be matched
            // so we need to check for that first
            if (!has_dev_catch_all and !@"has /*" and this.config.onNodeHTTPRequest != .zero) {
                app.any("/*", *ThisServer, this, onNodeHTTPRequest);
            } else if (!has_dev_catch_all and !@"has /*" and this.config.onRequest != .zero) {
                app.any("/*", *ThisServer, this, onRequest);
            } else if (!has_dev_catch_all and this.config.onNodeHTTPRequest != .zero) {
                app.post("/*", *ThisServer, this, onNodeHTTPRequest);
                app.put("/*", *ThisServer, this, onNodeHTTPRequest);
                app.patch("/*", *ThisServer, this, onNodeHTTPRequest);
                app.delete("/*", *ThisServer, this, onNodeHTTPRequest);
                app.options("/*", *ThisServer, this, onNodeHTTPRequest);
                app.trace("/*", *ThisServer, this, onNodeHTTPRequest);
                app.connect("/*", *ThisServer, this, onNodeHTTPRequest);
            } else if (!has_dev_catch_all and this.config.onRequest != .zero) {
                // "/*" routes are added backwards, so if they have a static route,
                // it will never be matched so we need to check for that first
                if (!@"has /*") {
                    app.any("/*", *ThisServer, this, onRequest);
                } else {
                    // The HTML catch-all receives GET, HEAD.
                    app.post("/*", *ThisServer, this, onRequest);
                    app.put("/*", *ThisServer, this, onRequest);
                    app.patch("/*", *ThisServer, this, onRequest);
                    app.delete("/*", *ThisServer, this, onRequest);
                    app.options("/*", *ThisServer, this, onRequest);
                    app.trace("/*", *ThisServer, this, onRequest);
                    app.connect("/*", *ThisServer, this, onRequest);
                }
            } else if (!has_dev_catch_all and this.config.onRequest == .zero and !@"has /*") {
                app.any("/*", *ThisServer, this, on404);
            } else if (!has_dev_catch_all and this.config.onRequest == .zero) {
                app.post("/*", *ThisServer, this, on404);
                app.put("/*", *ThisServer, this, on404);
                app.patch("/*", *ThisServer, this, on404);
                app.delete("/*", *ThisServer, this, on404);
                app.options("/*", *ThisServer, this, on404);
                app.trace("/*", *ThisServer, this, on404);
                app.connect("/*", *ThisServer, this, on404);
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
    };
}

pub const SavedRequest = struct {
    js_request: JSC.Strong,
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
    tracker: JSC.AsyncTaskTracker,

    pub usingnamespace bun.New(@This());

    pub fn runFromJSThread(this: *ServerAllConnectionsClosedTask, vm: *JSC.VirtualMachine) void {
        httplog("ServerAllConnectionsClosedTask runFromJSThread", .{});

        const globalObject = this.globalObject;
        const tracker = this.tracker;
        tracker.willDispatch(globalObject);
        defer tracker.didDispatch(globalObject);

        var promise = this.promise;
        defer promise.deinit();
        this.destroy();

        if (!vm.isShuttingDown()) {
            promise.resolve(globalObject, .undefined);
        }
    }
};

pub const HTTPServer = NewServer(JSC.Codegen.JSHTTPServer, false, false);
pub const HTTPSServer = NewServer(JSC.Codegen.JSHTTPSServer, true, false);
pub const DebugHTTPServer = NewServer(JSC.Codegen.JSDebugHTTPServer, false, true);
pub const DebugHTTPSServer = NewServer(JSC.Codegen.JSDebugHTTPSServer, true, true);
pub const AnyServer = struct {
    ptr: Ptr,

    pub const Ptr = bun.TaggedPointerUnion(.{
        HTTPServer,
        HTTPSServer,
        DebugHTTPServer,
        DebugHTTPSServer,
    });

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

    pub fn appendStaticRoute(this: AnyServer, path: []const u8, route: AnyRoute) !void {
        return switch (this.ptr.tag()) {
            Ptr.case(HTTPServer) => this.ptr.as(HTTPServer).appendStaticRoute(path, route),
            Ptr.case(HTTPSServer) => this.ptr.as(HTTPSServer).appendStaticRoute(path, route),
            Ptr.case(DebugHTTPServer) => this.ptr.as(DebugHTTPServer).appendStaticRoute(path, route),
            Ptr.case(DebugHTTPSServer) => this.ptr.as(DebugHTTPSServer).appendStaticRoute(path, route),
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

    pub fn webSocketHandler(this: AnyServer) ?*WebSocketServer.Handler {
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
    ) ?SavedRequest {
        return switch (server.ptr.tag()) {
            Ptr.case(HTTPServer) => (server.ptr.as(HTTPServer).prepareJsRequestContext(req, resp.TCP, null, true) orelse return null).save(global, req, resp.TCP),
            Ptr.case(HTTPSServer) => (server.ptr.as(HTTPSServer).prepareJsRequestContext(req, resp.SSL, null, true) orelse return null).save(global, req, resp.SSL),
            Ptr.case(DebugHTTPServer) => (server.ptr.as(DebugHTTPServer).prepareJsRequestContext(req, resp.TCP, null, true) orelse return null).save(global, req, resp.TCP),
            Ptr.case(DebugHTTPSServer) => (server.ptr.as(DebugHTTPSServer).prepareJsRequestContext(req, resp.SSL, null, true) orelse return null).save(global, req, resp.SSL),
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
const welcome_page_html_gz = @embedFile("welcome-page.html.gz");

extern fn Bun__addInspector(bool, *anyopaque, *JSC.JSGlobalObject) void;

const assert = bun.assert;

pub export fn Server__setIdleTimeout(server: JSC.JSValue, seconds: JSC.JSValue, globalThis: *JSC.JSGlobalObject) void {
    Server__setIdleTimeout_(server, seconds, globalThis) catch return;
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

comptime {
    _ = Server__setIdleTimeout;
    _ = NodeHTTPResponse.create;
}

extern fn NodeHTTPServer__onRequest_http(
    any_server: usize,
    globalThis: *JSC.JSGlobalObject,
    this: JSC.JSValue,
    callback: JSC.JSValue,
    request: *uws.Request,
    response: *uws.NewApp(false).Response,
    upgrade_ctx: ?*uws.uws_socket_context_t,
    node_response_ptr: *?*NodeHTTPResponse,
) JSC.JSValue;

extern fn NodeHTTPServer__onRequest_https(
    any_server: usize,
    globalThis: *JSC.JSGlobalObject,
    this: JSC.JSValue,
    callback: JSC.JSValue,
    request: *uws.Request,
    response: *uws.NewApp(true).Response,
    upgrade_ctx: ?*uws.uws_socket_context_t,
    node_response_ptr: *?*NodeHTTPResponse,
) JSC.JSValue;

extern fn NodeHTTP_assignOnCloseFunction(bool, *anyopaque) void;

extern fn NodeHTTP_setUsingCustomExpectHandler(bool, *anyopaque, bool) void;

fn throwSSLErrorIfNecessary(globalThis: *JSC.JSGlobalObject) bool {
    const err_code = BoringSSL.ERR_get_error();
    if (err_code != 0) {
        defer BoringSSL.ERR_clear_error();
        globalThis.throwValue(JSC.API.Bun.Crypto.createCryptoError(globalThis, err_code)) catch {};
        return true;
    }

    return false;
}

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
