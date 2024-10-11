//! Bake is Bun's toolkit for building client+server web applications. It
//! combines `Bun.build` and `Bun.serve`, providing a hot-reloading development
//! server, server components, and other integrations. Instead of taking the
//! role as a framework, Bake is tool for frameworks to build on top of.

/// Temporary function to invoke dev server via JavaScript. Will be
/// replaced with a user-facing API. Refs the event loop forever.
pub fn jsWipDevServer(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
    if (!bun.FeatureFlags.bake) return .undefined;

    BakeInitProcessIdentifier();

    bun.Output.warn(
        \\Be advised that Bun Bake is highly experimental, and its API
        \\will have breaking changes. Join the <magenta>#bake<r> Discord
        \\channel to help us find bugs: <blue>https://bun.sh/discord<r>
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

extern fn BakeInitProcessIdentifier() void;

/// A "Framework" in our eyes is simply set of bundler options that a framework
/// author would set in order to integrate the framework with the application.
///
/// Full documentation on these fields is located in the TypeScript definitions.
pub const Framework = struct {
    entry_client: []const u8,
    entry_server: []const u8,

    server_components: ?ServerComponents = null,
    react_fast_refresh: ?ReactFastRefresh = null,

    built_in_modules: bun.StringArrayHashMapUnmanaged(BuiltInModule) = .{},

    /// Bun provides built-in support for using React as a framework.
    /// Depends on externally provided React
    ///
    /// $ bun i react@experimental react-dom@experimental react-server-dom-webpack@experimental react-refresh@experimental
    pub fn react() Framework {
        return .{
            .server_components = .{
                .separate_ssr_graph = true,
                .server_runtime_import = "react-server-dom-webpack/server",
                // .client_runtime_import = "react-server-dom-webpack/client",
            },
            .react_fast_refresh = .{},
            .entry_client = "bun-framework-rsc/client.tsx",
            .entry_server = "bun-framework-rsc/server.tsx",
            .built_in_modules = bun.StringArrayHashMapUnmanaged(BuiltInModule).init(bun.default_allocator, &.{
                "bun-framework-rsc/client.tsx",
                "bun-framework-rsc/server.tsx",
                "bun-framework-rsc/ssr.tsx",
            }, if (Environment.codegen_embed) &.{
                .{ .code = @embedFile("./bun-framework-rsc/client.tsx") },
                .{ .code = @embedFile("./bun-framework-rsc/server.tsx") },
                .{ .code = @embedFile("./bun-framework-rsc/ssr.tsx") },
            } else &.{
                .{ .code = bun.runtimeEmbedFile(.src, "bake/bun-framework-rsc/client.tsx") },
                .{ .code = bun.runtimeEmbedFile(.src, "bake/bun-framework-rsc/server.tsx") },
                .{ .code = bun.runtimeEmbedFile(.src, "bake/bun-framework-rsc/ssr.tsx") },
            }) catch bun.outOfMemory(),
        };
    }

    const BuiltInModule = union(enum) {
        import: []const u8,
        code: []const u8,
    };

    const ServerComponents = struct {
        separate_ssr_graph: bool = false,
        server_runtime_import: []const u8,
        // client_runtime_import: []const u8,
        server_register_client_reference: []const u8 = "registerClientReference",
        server_register_server_reference: []const u8 = "registerServerReference",
        client_register_server_reference: []const u8 = "registerServerReference",
    };

    const ReactFastRefresh = struct {
        import_source: []const u8 = "react-refresh/runtime",
    };

    /// Given a Framework configuration, this returns another one with all modules resolved.
    ///
    /// All resolution errors will happen before returning error.ModuleNotFound
    /// Details written into `r.log`
    pub fn resolve(f: Framework, server: *bun.resolver.Resolver, client: *bun.resolver.Resolver) !Framework {
        var clone = f;
        var had_errors: bool = false;

        f.resolveHelper(client, &clone.entry_client, &had_errors, "client entrypoint");
        f.resolveHelper(server, &clone.entry_server, &had_errors, "server entrypoint");

        if (clone.react_fast_refresh) |*react_fast_refresh| {
            f.resolveHelper(client, &react_fast_refresh.import_source, &had_errors, "react refresh runtime");
        }

        if (clone.server_components) |*sc| {
            f.resolveHelper(server, &sc.server_runtime_import, &had_errors, "server components runtime");
            // f.resolveHelper(client, &sc.client_runtime_import, &had_errors);
        }

        if (had_errors) return error.ModuleNotFound;

        return clone;
    }

    inline fn resolveHelper(f: *const Framework, r: *bun.resolver.Resolver, path: *[]const u8, had_errors: *bool, desc: []const u8) void {
        if (f.built_in_modules.get(path.*)) |mod| {
            switch (mod) {
                .import => |p| path.* = p,
                .code => {},
            }
            return;
        }

        var result = r.resolve(r.fs.top_level_dir, path.*, .stmt) catch |err| {
            bun.Output.err(err, "Failed to resolve '{s}' for framework ({s})", .{ path.*, desc });
            had_errors.* = true;
            return;
        };
        path.* = result.path().?.text; // TODO: what is the lifetime of this string
    }

    // TODO: This function always leaks memory.
    // `Framework` has no way to specify what is allocated, nor should it.
    fn fromJS(opts: JSValue, global: *JSC.JSGlobalObject) !Framework {
        if (opts.isString()) {
            const str = opts.toBunString(global);
            defer str.deref();
            if (str.eqlComptime("react-server-components")) {
                return Framework.react();
            }
        }

        if (!opts.isObject()) {
            global.throwInvalidArguments("Framework must be an object", .{});
            return error.JSError;
        }
        return .{
            .entry_server = brk: {
                const prop: JSValue = opts.get(global, "serverEntryPoint") orelse {
                    if (!global.hasException())
                        global.throwInvalidArguments("Missing 'framework.serverEntryPoint'", .{});
                    return error.JSError;
                };
                const str = prop.toBunString(global);
                defer str.deref();

                if (global.hasException())
                    return error.JSError;

                // Leak
                break :brk str.toUTF8(bun.default_allocator).slice();
            },
            .entry_client = brk: {
                const prop: JSValue = opts.get(global, "clientEntryPoint") orelse {
                    if (!global.hasException())
                        global.throwInvalidArguments("Missing 'framework.clientEntryPoint'", .{});
                    return error.JSError;
                };
                const str = prop.toBunString(global);
                defer str.deref();

                if (global.hasException())
                    return error.JSError;

                // Leak
                break :brk str.toUTF8(bun.default_allocator).slice();
            },
            .react_fast_refresh = brk: {
                const rfr: JSValue = opts.get(global, "reactFastRefresh") orelse {
                    if (global.hasException())
                        return error.JSError;
                    break :brk null;
                };
                if (rfr == .true) break :brk .{};
                if (rfr == .false or rfr == .null or rfr == .undefined) break :brk null;
                if (!rfr.isObject()) {
                    global.throwInvalidArguments("'framework.reactFastRefresh' must be an object or 'true'", .{});
                    return error.JSError;
                }
                // in addition to here, this import isnt actually wired up to js_parser where the default is hardcoded.
                bun.todoPanic(@src(), "custom react-fast-refresh import source", .{});
            },
            .server_components = sc: {
                const sc: JSValue = opts.get(global, "serverComponents") orelse {
                    if (global.hasException())
                        return error.JSError;
                    break :sc null;
                };
                if (sc == .null or sc == .undefined) break :sc null;

                break :sc .{
                    // .client_runtime_import = "",
                    .separate_ssr_graph = brk: {
                        const prop: JSValue = sc.get(global, "separateSSRGraph") orelse {
                            if (!global.hasException())
                                global.throwInvalidArguments("Missing 'framework.serverComponents.separateSSRGraph'", .{});
                            return error.JSError;
                        };
                        if (prop == .true) break :brk true;
                        if (prop == .false) break :brk false;
                        global.throwInvalidArguments("'framework.serverComponents.separateSSRGraph' must be a boolean", .{});
                        return error.JSError;
                    },
                    .server_runtime_import = brk: {
                        const prop: JSValue = sc.get(global, "serverRuntimeImportSource") orelse {
                            if (!global.hasException())
                                global.throwInvalidArguments("Missing 'framework.serverComponents.serverRuntimeImportSource'", .{});
                            return error.JSError;
                        };
                        const str = prop.toBunString(global);
                        defer str.deref();

                        if (global.hasException())
                            return error.JSError;

                        // Leak
                        break :brk str.toUTF8(bun.default_allocator).slice();
                    },
                    .server_register_client_reference = brk: {
                        const prop: JSValue = sc.get(global, "serverRegisterClientReferenceExport") orelse {
                            if (!global.hasException())
                                global.throwInvalidArguments("Missing 'framework.serverComponents.serverRegisterClientReferenceExport'", .{});
                            return error.JSError;
                        };
                        const str = prop.toBunString(global);
                        defer str.deref();

                        if (global.hasException())
                            return error.JSError;

                        // Leak
                        break :brk str.toUTF8(bun.default_allocator).slice();
                    },
                };
            },
        };
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

    const framework_js = options.get(global, "framework") orelse {
        return error.Invalid;
    };
    const framework = try Framework.fromJS(framework_js, global);
    return .{
        .cwd = bun.getcwdAlloc(bun.default_allocator) catch bun.outOfMemory(),
        .routes = routes,
        .framework = framework,
    };
}

export fn Bun__getTemporaryDevServer(global: *JSC.JSGlobalObject) JSValue {
    if (!bun.FeatureFlags.bake) return .undefined;
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
    return if (Environment.codegen_embed)
        switch (mode) {
            .client => @embedFile("bake-codegen/bake.client.js"),
            .server => @embedFile("bake-codegen/bake.server.js"),
        }
    else switch (mode) {
        inline else => |m| bun.runtimeEmbedFile(.codegen_eager, "bake." ++ @tagName(m) ++ ".js"),
    };
}

pub const Mode = enum { production, development };
pub const Side = enum { client, server };
pub const Graph = enum(u2) {
    client,
    server,
    /// Only used when Framework has .server_components.separate_ssr_graph set
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
    .path = bun.fs.Path.initForKitBuiltIn("bun", "bake/server"),
    .key_path = bun.fs.Path.initForKitBuiltIn("bun", "bake/server"),
    .contents = "", // Virtual
    .index = bun.JSAst.Index.bake_server_data,
};

pub const client_virtual_source: bun.logger.Source = .{
    .path = bun.fs.Path.initForKitBuiltIn("bun", "bake/client"),
    .key_path = bun.fs.Path.initForKitBuiltIn("bun", "bake/client"),
    .contents = "", // Virtual
    .index = bun.JSAst.Index.bake_client_data,
};

pub const DevServer = @import("./DevServer.zig");

const std = @import("std");

const bun = @import("root").bun;
const Environment = bun.Environment;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
