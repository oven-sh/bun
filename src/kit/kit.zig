//! Kit is the code name for the work-in-progress "Framework API [SOON]" for Bun.

/// Temporary function to invoke dev server via JavaScript. Will be
/// replaced with a user-facing API. Refs the event loop forever.
///
/// Requires one argument object for configuration. Very little is
/// exposed over the JS api as it is not intended to be used for
/// real applications yet.
/// ```ts
/// interface WipDevServerOptions {
///     routes: WipDevServerRoute[]
/// }
/// interface WipDevServerRoute {
///     pattern: string;
///     entrypoint: string;
/// }
/// ```
pub fn jsWipDevServer(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
    if (!bun.FeatureFlags.kit) return .undefined;

    bun.Output.warn(
        \\Be advised that Bun Kit is highly experimental, and its API will have
        \\breaking changes. Join the <magenta>#kit<r> Discord channel to help us find bugs
        \\and suggest use-cases/features: <blue>https://bun.sh/discord<r>
        \\
        \\
    , .{});
    bun.Output.flush();

    const options = devServerOptionsFromJs(global, callframe.argument(0)) catch {
        if (!global.hasException())
            global.throwInvalidArguments("invalid arguments", .{});
        return .zero;
    };

    // TODO: this should inherit the current VM, running on the main thread.
    const t = std.Thread.spawn(.{}, wipDevServer, .{options}) catch @panic("Failed to start");
    t.detach();

    {
        var futex = std.atomic.Value(u32).init(0);
        while (true) std.Thread.Futex.wait(&futex, 0);
    }
}

/// A "Framework" in our eyes is simply set of bundler options that a framework
/// author would set in order to integrate the framework with the application.
///
/// Full documentation on these fields is located in the TypeScript definitions.
pub const Framework = struct {
    entry_client: ?[]const u8 = null,
    entry_server: ?[]const u8 = null,

    server_components: ?ServerComponents = null,
    react_fast_refresh: ?ReactFastRefresh = null,

    /// Bun provides built-in support for using React as a framework
    pub fn react() Framework {
        return .{
            .server_components = .{
                .separate_ssr_graph = true,
                .server_runtime_import = "react-server-dom-webpack/server",
                .client_runtime_import = "react-server-dom-webpack/client",
            },
            .react_fast_refresh = .{
                .import_source = "react-refresh/runtime",
            },
            // TODO: embed these in bun
            .entry_client = "./framework/client.tsx",
            .entry_server = "./framework/server.tsx",
        };
    }

    const ServerComponents = struct {
        separate_ssr_graph: bool = false,
        server_runtime_import: []const u8,
        client_runtime_import: []const u8,
        server_register_client_reference: []const u8 = "registerClientReference",
        server_register_server_reference: []const u8 = "registerServerReference",
        client_register_server_reference: []const u8 = "registerServerReference",
    };

    const ReactFastRefresh = struct {
        import_source: []const u8,
    };

    /// Given a Framework configuration, this returns another one with all modules resolved.
    ///
    /// All resolution errors will happen before returning error.ModuleNotFound
    /// Details written into `r.log`
    pub fn resolve(f: Framework, server: *bun.resolver.Resolver, client: *bun.resolver.Resolver) !Framework {
        var clone = f;
        var had_errors: bool = false;

        if (clone.entry_client) |*path| resolveHelper(client, path, &had_errors);
        if (clone.entry_server) |*path| resolveHelper(server, path, &had_errors);

        if (clone.react_fast_refresh) |*react_fast_refresh| {
            resolveHelper(client, &react_fast_refresh.import_source, &had_errors);
        }

        if (clone.server_components) |*sc| {
            resolveHelper(server, &sc.server_runtime_import, &had_errors);
            resolveHelper(client, &sc.client_runtime_import, &had_errors);
        }

        if (had_errors) return error.ModuleNotFound;

        return clone;
    }

    inline fn resolveHelper(r: *bun.resolver.Resolver, path: *[]const u8, had_errors: *bool) void {
        var result = r.resolve(r.fs.top_level_dir, path.*, .stmt) catch |err| {
            bun.Output.err(err, "Failed to resolve '{s}' for framework", .{path.*});
            had_errors.* = true;

            return;
        };
        path.* = result.path().?.text; // TODO: what is the lifetime of this string
    }
};

// TODO: this function leaks memory and bad error handling, but that is OK since
// this API is not finalized.
fn devServerOptionsFromJs(global: *JSC.JSGlobalObject, options: JSValue) !DevServer.Options {
    if (!options.isObject()) return error.Invalid;
    const routes_js = try options.getArray(global, "routes") orelse return error.Invalid;

    const len = routes_js.getLength(global);
    const routes = try bun.default_allocator.alloc(DevServer.Route, len);

    var it = routes_js.arrayIterator(global);
    var i: usize = 0;
    while (it.next()) |route| : (i += 1) {
        if (!route.isObject()) return error.Invalid;

        const pattern_js = route.get(global, "pattern") orelse return error.Invalid;
        if (!pattern_js.isString()) return error.Invalid;
        const entry_point_js = route.get(global, "entrypoint") orelse return error.Invalid;
        if (!entry_point_js.isString()) return error.Invalid;

        const pattern = pattern_js.toBunString(global).toUTF8(bun.default_allocator);
        defer pattern.deinit();
        // TODO: this dupe is stupid
        const pattern_z = try bun.default_allocator.dupeZ(u8, pattern.slice());
        const entry_point = entry_point_js.toBunString(global).toUTF8(bun.default_allocator).slice(); // leak

        routes[i] = .{
            .pattern = pattern_z,
            .entry_point = entry_point,
        };
    }

    return .{
        .cwd = bun.getcwdAlloc(bun.default_allocator) catch bun.outOfMemory(),
        .routes = routes,
        .framework = Framework.react(),
    };
}

export fn Bun__getTemporaryDevServer(global: *JSC.JSGlobalObject) JSValue {
    if (!bun.FeatureFlags.kit) return .undefined;
    return JSC.JSFunction.create(global, "wipDevServer", bun.JSC.toJSHostFunction(jsWipDevServer), 0, .{});
}

pub fn wipDevServer(options: DevServer.Options) noreturn {
    bun.Output.Source.configureNamedThread("Dev Server");

    const dev = DevServer.init(options) catch |err| switch (err) {
        error.FrameworkInitialization => bun.Global.exit(1),
        else => {
            bun.handleErrorReturnTrace(err, @errorReturnTrace());
            bun.Output.panic("Failed to init DevServer: {}", .{err});
        },
    };
    dev.runLoopForever();
}

pub fn getHmrRuntime(mode: Side) []const u8 {
    return if (Environment.embed_code)
        switch (mode) {
            .client => @embedFile("kit-codegen/kit.client.js"),
            .server => @embedFile("kit-codegen/kit.server.js"),
        }
    else switch (mode) {
        inline else => |m| bun.runtimeEmbedFile(.codegen, "kit." ++ @tagName(m) ++ ".js"),
    };
}

pub const Mode = enum { production, development };
pub const Side = enum { client, server };
pub const Renderer = enum {
    client,
    server,
    /// Only used Framework has .server_components.separate_ssr_graph set
    ssr,
};

pub fn addImportMetaDefines(
    allocator: std.mem.Allocator,
    define: *bun.options.Define,
    mode: Mode,
    side: Side,
) !void {
    const Define = bun.options.Define;

    // The following are from Vite: https://vitejs.dev/guide/env-and-mode
    // TODO: MODE, BASE_URL
    try define.insert(
        allocator,
        "import.meta.env.DEV",
        Define.Data.initBoolean(mode == .development),
    );
    try define.insert(
        allocator,
        "import.meta.env.PROD",
        Define.Data.initBoolean(mode == .production),
    );
    try define.insert(
        allocator,
        "import.meta.env.SSR",
        Define.Data.initBoolean(side == .server),
    );
}

pub const server_virtual_source: bun.logger.Source = .{
    .path = bun.fs.Path.initForKitBuiltIn("bun", "kit/server"),
    .key_path = bun.fs.Path.initForKitBuiltIn("bun", "kit/server"),
    .contents = "", // Virtual
    .index = bun.JSAst.Index.kit_server_data,
};

pub const client_virtual_source: bun.logger.Source = .{
    .path = bun.fs.Path.initForKitBuiltIn("bun", "kit/client"),
    .key_path = bun.fs.Path.initForKitBuiltIn("bun", "kit/client"),
    .contents = "", // Virtual
    .index = bun.JSAst.Index.kit_client_data,
};

pub const DevServer = @import("./DevServer.zig");

const std = @import("std");

const bun = @import("root").bun;
const Environment = bun.Environment;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
