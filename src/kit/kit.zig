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
        \\Be advised that Bun Kit is experimental, and its API is likely to change.
    , .{});
    bun.Output.flush();

    const options = devServerOptionsFromJs(global, callframe.argument(0)) catch {
        if (!global.hasException())
            global.throwInvalidArguments("invalid arguments", .{});
        return .zero;
    };

    const t = std.Thread.spawn(.{}, wipDevServer, .{options}) catch @panic("Failed to start");
    t.detach();

    {
        var futex = std.atomic.Value(u32).init(0);
        while (true) std.Thread.Futex.wait(&futex, 0);
    }
}

/// A "Framework" in our eyes is simply set of bundler options that a framework
/// author would set in order to integrate the framework with the application.
pub const Framework = struct {
    /// This file is the true entrypoint of the client application.
    ///
    /// It can import the client manifest via the `bun:client-manifest` import
    ///
    /// TODO: how this behaves when server components are off
    entry_client: ?[]const u8 = null,

    /// This file is the true entrypoint of the server application. This module
    /// must `export default` a fetch function, which takes a request and the
    /// bundled route module, and returns a response.
    entry_server: ?[]const u8 = null,

    /// Bun offers integration for React's Server Components with an
    /// interface that is generic enough to adapt to any framework.
    server_components: ?ServerComponents = null,
    /// It is unliekly Fast Refresh is useful outside of React.
    react_fast_refresh: ?ReactFastRefresh = null,

    /// Bun provides built-in support for using React as a framework
    pub fn react() Framework {
        return .{
            .server_components = .{
                .server_runtime_import = "react-server-dom-webpack/server",
                .client_runtime_import = "react-server-dom-webpack/client",
            },
            .react_fast_refresh = .{
                .import_source = "react-refresh",
            },
            // TODO: embed these in bun
            .entry_client = "./entry_client.tsx",
            .entry_server = "./entry_server.tsx",
        };
    }

    /// A high-level overview of what server components means exists
    /// in the React Docs: https://react.dev/reference/rsc/server-components
    ///
    /// When enabled, files with "use server" and "use client" directives
    /// will get special processing, using this configuration to implement
    /// server rendering and browser interactivity.
    const ServerComponents = struct {
        server_runtime_import: []const u8,
        client_runtime_import: []const u8,

        /// When server code imports client code, a stub module is generated,
        /// where every export calls this export from `server_runtime_import`.
        /// This is used to implement client components on the server.
        ///
        /// The call is given three arguments:
        ///
        ///     export const ClientComp = registerClientReference(
        ///         // A function which may be passed through, it throws an error
        ///         function () { throw new Error('Cannot call client-component on the server') },
        ///
        ///         // The file path. In production, these use hashed strings for
        ///         // compactness and code privacy.
        ///         "src/components/Client.tsx",
        ///
        ///         // The component name.
        ///         "ClientComp",
        ///     );
        ///
        /// The bundler will take care of ensuring referenced client imports.
        server_register_client_reference: []const u8 = "registerClientReference",
        server_register_server_reference: []const u8 = "registerServerReference",

        client_register_server_reference: []const u8 = "registerServerReference",
    };

    const ReactFastRefresh = struct {
        import_source: []const u8,
        register_export: []const u8 = "register",
        create_signature_export: []const u8 = "createSignatureFunctionForTransform",
        inject_export: []const u8 = "injectIntoGlobalHook",
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

pub const DevServer = @import("./DevServer.zig");

const std = @import("std");

const bun = @import("root").bun;
const Environment = bun.Environment;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
