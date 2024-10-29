//! Bake is Bun's toolkit for building client+server web applications. It
//! combines `Bun.build` and `Bun.serve`, providing a hot-reloading development
//! server, server components, and other integrations. Instead of taking the
//! role as a framework, Bake is tool for frameworks to build on top of.

pub const production = @import("./production.zig");
pub const DevServer = @import("./DevServer.zig");
pub const FrameworkRouter = @import("./FrameworkRouter.zig");

/// export default { app: ... };
pub const api_name = "app";

/// Zig version of the TS definition 'Bake.Options' in 'bake.d.ts'
pub const UserOptions = struct {
    allocations: AllocationList,

    root: []const u8,
    framework: Framework,

    bundler_options: SplitBundlerOptions,

    // TODO: move to FrameworkRouter
    routes: []DevServer.Route,

    pub fn deinit(options: *UserOptions) void {
        bun.default_allocator.free(options.routes);
        options.framework.deinit(bun.default_allocator);
        options.allocations.free();
    }

    pub fn fromJS(config: JSValue, global: *JSC.JSGlobalObject) !UserOptions {
        if (!config.isObject()) {
            return global.throwInvalidArguments2("'" ++ api_name ++ "' is not an object", .{});
        }

        var allocations = AllocationList.empty;
        errdefer allocations.free();
        var bundler_options: SplitBundlerOptions = .{};
        // errdefer bundler_options.deinit();

        const routes_js: JSValue = try config.getArray(global, "routes") orelse {
            return global.throwInvalidArguments2("'" ++ api_name ++ "' is missing 'routes'", .{});
        };

        const len = routes_js.getLength(global);
        const routes = try bun.default_allocator.alloc(DevServer.Route, len);

        var it = routes_js.arrayIterator(global);
        var i: usize = 0;
        while (it.next()) |route| : (i += 1) {
            if (!route.isObject()) {
                return global.throwInvalidArguments2("'routes[{d}]' is not an object", .{i});
            }

            const pattern = try route.getOptional(global, "pattern", ZigString.Slice) orelse {
                return global.throwInvalidArguments2("'routes[{d}]' is missing 'pattern'", .{i});
            };
            defer pattern.deinit();

            const entry_point = try getOptionalString(route, global, "entrypoint", &allocations) orelse {
                return global.throwInvalidArguments2("'routes[{d}]' is missing 'entrypoint'", .{i});
            };

            routes[i] = .{
                .pattern = allocations.trackSliceZ(try bun.default_allocator.dupeZ(u8, pattern.slice())),
                .entry_point = entry_point,
            };
        }

        var framework = try Framework.fromJS(
            try config.get2(global, "framework") orelse {
                return global.throwInvalidArguments2("'" ++ api_name ++ "' is missing 'framework'", .{});
            },
            global,
            &allocations,
            &bundler_options,
        );
        errdefer framework.deinit(bun.default_allocator);

        const root = if (try config.getOptional(global, "framework", ZigString.Slice)) |slice|
            allocations.track(slice)
        else
            allocations.trackSlice(
                bun.getcwdAlloc(bun.default_allocator) catch |err| switch (err) {
                    error.OutOfMemory => {
                        global.throwOutOfMemory();
                        return global.jsErrorFromCPP();
                    },
                    else => {
                        global.throwError(err, "while querying current working directory");
                        return global.jsErrorFromCPP();
                    },
                },
            );

        return .{
            .allocations = allocations,
            .root = root,
            .routes = routes,
            .framework = framework,
            .bundler_options = bundler_options,
        };
    }
};

/// Each string stores its allocator since some may hold reference counts to JSC
const AllocationList = struct {
    allocations: std.ArrayListUnmanaged(ZigString.Slice),

    pub fn track(al: *AllocationList, str: ZigString.Slice) []const u8 {
        al.allocations.append(bun.default_allocator, str) catch bun.outOfMemory();
        return str.slice();
    }

    pub fn trackSlice(al: *AllocationList, str: []const u8) []const u8 {
        al.allocations.append(bun.default_allocator, ZigString.Slice.init(bun.default_allocator, str)) catch bun.outOfMemory();
        return str;
    }

    pub fn trackSliceZ(al: *AllocationList, str: [:0]const u8) [:0]const u8 {
        al.allocations.append(bun.default_allocator, ZigString.Slice.init(bun.default_allocator, str)) catch bun.outOfMemory();
        return str;
    }

    pub fn free(al: *AllocationList) void {
        for (al.allocations.items) |item| item.deinit();
        al.allocations.clearAndFree(bun.default_allocator);
    }

    pub const empty: AllocationList = .{ .allocations = .{} };
};

const SplitBundlerOptions = struct {
    all: BuildConfigSubset = .{},
    client: BuildConfigSubset = .{},
    server: BuildConfigSubset = .{},
    ssr: BuildConfigSubset = .{},
};

const BuildConfigSubset = struct {
    loader: ?bun.Schema.Api.LoaderMap = null,
    ignoreDCEAnnotations: ?bool = null,
    conditions: bun.StringArrayHashMapUnmanaged(void) = .{},
    drop: bun.StringArrayHashMapUnmanaged(void) = .{},
    // TODO: plugins
};

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

    const options = UserOptions.fromJS(callframe.argument(0), global) catch {
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

    pub fn deinit(fw: *Framework, alloc: std.mem.Allocator) void {
        fw.built_in_modules.deinit(alloc);
    }

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

    fn fromJS(
        opts: JSValue,
        global: *JSC.JSGlobalObject,
        allocations: *AllocationList,
        bundler_options: *SplitBundlerOptions,
    ) !Framework {
        _ = bundler_options; // autofix
        if (opts.isString()) {
            const str = try opts.toBunString2(global);
            defer str.deref();

            // Deprecated
            if (str.eqlComptime("react-server-components")) {
                bun.Output.warn("framework: 'react-server-components' will be renamed to 'react'", .{});
                return Framework.react();
            }

            if (str.eqlComptime("react")) {
                return Framework.react();
            }
        }

        if (!opts.isObject()) {
            return global.throwInvalidArguments2("Framework must be an object", .{});
        }

        var framework: Framework = .{
            .entry_server = try getOptionalString(opts, global, "serverEntryPoint", allocations) orelse {
                return global.throwInvalidArguments2("Missing 'framework.serverEntryPoint'", .{});
            },
            .entry_client = try getOptionalString(opts, global, "clientEntryPoint", allocations) orelse {
                return global.throwInvalidArguments2("Missing 'framework.clientEntryPoint'", .{});
            },
            .react_fast_refresh = brk: {
                const rfr: JSValue = try opts.get2(global, "reactFastRefresh") orelse
                    break :brk null;

                if (rfr == .true) break :brk .{};
                if (rfr == .false or rfr == .null or rfr == .undefined) break :brk null;

                if (!rfr.isObject()) {
                    return global.throwInvalidArguments2("'framework.reactFastRefresh' must be an object or 'true'", .{});
                }

                const prop = rfr.get(global, "importSource") orelse {
                    return global.throwInvalidArguments2("'framework.reactFastRefresh' is missing 'importSource'", .{});
                };

                const str = try prop.toBunString2(global);
                defer str.deref();

                break :brk .{
                    .import_source = allocations.track(str.toUTF8(bun.default_allocator)),
                };
            },
            .server_components = sc: {
                const sc: JSValue = try opts.get2(global, "serverComponents") orelse
                    break :sc null;
                if (sc == .false or sc == .null or sc == .undefined) break :sc null;

                if (!sc.isObject()) {
                    return global.throwInvalidArguments2("'framework.serverComponents' must be an object or 'undefined'", .{});
                }

                break :sc .{
                    .separate_ssr_graph = brk: {
                        // Intentionally not using a truthiness check
                        const prop = try sc.getOptional(global, "separateSSRGraph", JSValue) orelse {
                            return global.throwInvalidArguments2("Missing 'framework.serverComponents.separateSSRGraph'", .{});
                        };
                        if (prop == .true) break :brk true;
                        if (prop == .false) break :brk false;
                        return global.throwInvalidArguments2("'framework.serverComponents.separateSSRGraph' must be a boolean", .{});
                    },
                    .server_runtime_import = allocations.track(
                        try sc.getOptional(global, "serverRuntimeImportSource", ZigString.Slice) orelse {
                            return global.throwInvalidArguments2("Missing 'framework.serverComponents.serverRuntimeImportSource'", .{});
                        },
                    ),
                    .server_register_client_reference = allocations.track(
                        try sc.getOptional(global, "serverRegisterClientReferenceExport", ZigString.Slice) orelse {
                            return global.throwInvalidArguments2("Missing 'framework.serverComponents.serverRegisterClientReferenceExport'", .{});
                        },
                    ),
                };
            },
            .built_in_modules = built_in_modules: {
                const array = try opts.getArray(global, "builtInModules") orelse
                    break :built_in_modules .{};

                const len = array.getLength(global);
                var files: bun.StringArrayHashMapUnmanaged(BuiltInModule) = .{};
                try files.ensureTotalCapacity(bun.default_allocator, len);

                var it = array.arrayIterator(global);
                var i: usize = 0;
                while (it.next()) |file| : (i += 1) {
                    if (!file.isObject()) {
                        return global.throwInvalidArguments2("'builtInModules[{d}]' is not an object", .{i});
                    }

                    const path = try getOptionalString(file, global, "import", allocations) orelse {
                        return global.throwInvalidArguments2("'builtInModules[{d}]' is missing 'import'", .{i});
                    };

                    const value: BuiltInModule = if (try getOptionalString(file, global, "path", allocations)) |str|
                        .{ .import = str }
                    else if (try getOptionalString(file, global, "code", allocations)) |str|
                        .{ .code = str }
                    else
                        return global.throwInvalidArguments2("'builtInModules[{d}]' needs either 'path' or 'code'", .{i});

                    files.putAssumeCapacity(path, value);
                }

                break :built_in_modules files;
            },
        };
        errdefer framework.deinit(bun.default_allocator);

        if (try opts.getOptional(global, "bundlerOptions", JSValue)) |js_options| {
            _ = js_options; // autofix
            // try SplitBundlerOptions.parseInto(global, js_options, bundler_options, .root);
        }

        return framework;
    }

    pub fn initBundler(
        framework: *Framework,
        allocator: std.mem.Allocator,
        log: *bun.logger.Log,
        mode: Mode,
        comptime renderer: Graph,
        out: *bun.bundler.Bundler,
    ) !void {
        out.* = try bun.Bundler.init(
            allocator, // TODO: this is likely a memory leak
            log,
            std.mem.zeroes(bun.Schema.Api.TransformOptions),
            null,
        );

        out.options.target = switch (renderer) {
            .client => .browser,
            .server, .ssr => .bun,
        };
        out.options.public_path = switch (renderer) {
            .client => DevServer.client_prefix,
            .server, .ssr => "",
        };
        out.options.entry_points = &.{};
        out.options.log = log;
        out.options.output_format = switch (mode) {
            .development => .internal_bake_dev,
            .production_dynamic, .production_static => .esm,
        };
        out.options.out_extensions = bun.StringHashMap([]const u8).init(out.allocator);
        out.options.hot_module_reloading = mode == .development;
        out.options.code_splitting = mode != .development;

        // force disable filesystem output, even though bundle_v2
        // is special cased to return before that code is reached.
        out.options.output_dir = "";

        // framework configuration
        out.options.react_fast_refresh = mode == .development and renderer == .client and framework.react_fast_refresh != null;
        out.options.server_components = framework.server_components != null;

        out.options.conditions = try bun.options.ESMConditions.init(allocator, out.options.target.defaultConditions());
        if (renderer == .server and framework.server_components != null) {
            try out.options.conditions.appendSlice(&.{"react-server"});
        }

        out.options.production = mode != .development;

        out.options.tree_shaking = mode != .development;
        out.options.minify_syntax = true; // required for DCE
        // out.options.minify_identifiers = mode != .development;
        // out.options.minify_whitespace = mode != .development;

        out.options.experimental_css = true;
        out.options.css_chunking = true;

        out.options.framework = framework;

        out.configureLinker();
        try out.configureDefines();

        out.options.jsx.development = mode == .development;

        try addImportMetaDefines(allocator, out.options.define, mode, switch (renderer) {
            .client => .client,
            .server, .ssr => .server,
        });

        if (mode != .development) {
            out.options.entry_naming = "[name]-[hash].[ext]";
            out.options.chunk_naming = "chunk-[name]-[hash].[ext]";
        }

        out.resolver.opts = out.options;
    }
};

fn getOptionalString(
    target: JSValue,
    global: *JSC.JSGlobalObject,
    property: []const u8,
    allocations: *AllocationList,
) !?[]const u8 {
    const value = try target.get2(global, property) orelse
        return null;
    if (value == .undefined or value == .null)
        return null;
    const str = try value.toBunString2(global);
    return allocations.track(str.toUTF8(bun.default_allocator));
}

export fn Bun__getTemporaryDevServer(global: *JSC.JSGlobalObject) JSValue {
    if (!bun.FeatureFlags.bake) return .undefined;
    return JSC.JSFunction.create(global, "wipDevServer", bun.JSC.toJSHostFunction(jsWipDevServer), 0, .{});
}

pub fn wipDevServer(options: UserOptions) noreturn {
    bun.Output.Source.configureNamedThread("Dev Server");

    const dev = DevServer.init(.{
        .cwd = options.root,
        .routes = options.routes,
        .framework = options.framework,
    }) catch |err| switch (err) {
        error.FrameworkInitialization => bun.Global.exit(1),
        else => {
            bun.handleErrorReturnTrace(err, @errorReturnTrace());
            bun.Output.panic("Failed to init DevServer: {}", .{err});
        },
    };
    dev.runLoopForever();
}

pub fn getHmrRuntime(side: Side) []const u8 {
    return if (Environment.codegen_embed)
        switch (side) {
            .client => @embedFile("bake-codegen/bake.client.js"),
            .server => @embedFile("bake-codegen/bake.server.js"),
        }
    else switch (side) {
        inline else => |m| bun.runtimeEmbedFile(.codegen_eager, "bake." ++ @tagName(m) ++ ".js"),
    };
}

pub const Mode = enum {
    development,
    production_dynamic,
    production_static,
};
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
    // Note that it is not currently possible to have mixed
    // modes (production + hmr dev server)
    // TODO: BASE_URL
    try define.insert(
        allocator,
        "import.meta.env.DEV",
        Define.Data.initBoolean(mode == .development),
    );
    try define.insert(
        allocator,
        "import.meta.env.PROD",
        Define.Data.initBoolean(mode != .development),
    );
    try define.insert(
        allocator,
        "import.meta.env.MODE",
        Define.Data.initStaticString(switch (mode) {
            .development => &.{ .data = "development" },
            .production_dynamic, .production_static => &.{ .data = "production" },
        }),
    );
    try define.insert(
        allocator,
        "import.meta.env.SSR",
        Define.Data.initBoolean(side == .server),
    );

    // To indicate a static build, `STATIC` is set to true then.
    try define.insert(
        allocator,
        "import.meta.env.STATIC",
        Define.Data.initBoolean(mode == .production_static),
    );
}

pub const server_virtual_source: bun.logger.Source = .{
    .path = bun.fs.Path.initForKitBuiltIn("bun", "bake/server"),
    .contents = "", // Virtual
    .index = bun.JSAst.Index.bake_server_data,
};

pub const client_virtual_source: bun.logger.Source = .{
    .path = bun.fs.Path.initForKitBuiltIn("bun", "bake/client"),
    .contents = "", // Virtual
    .index = bun.JSAst.Index.bake_client_data,
};

const std = @import("std");

const bun = @import("root").bun;
const Environment = bun.Environment;
const ZigString = bun.JSC.ZigString;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
