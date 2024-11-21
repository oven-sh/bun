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
    arena: std.heap.ArenaAllocator.State,
    allocations: StringRefList,

    root: []const u8,
    framework: Framework,
    bundler_options: SplitBundlerOptions,

    pub fn deinit(options: *UserOptions) void {
        options.arena.promote(bun.default_allocator).deinit();
        options.allocations.free();
    }

    pub fn fromJS(config: JSValue, global: *JSC.JSGlobalObject) !UserOptions {
        if (!config.isObject()) {
            return global.throwInvalidArguments("'" ++ api_name ++ "' is not an object", .{});
        }
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        errdefer arena.deinit();
        const alloc = arena.allocator();

        var allocations = StringRefList.empty;
        errdefer allocations.free();
        var bundler_options: SplitBundlerOptions = .{};

        const framework = try Framework.fromJS(
            try config.get(global, "framework") orelse {
                return global.throwInvalidArguments("'" ++ api_name ++ "' is missing 'framework'", .{});
            },
            global,
            &allocations,
            &bundler_options,
            alloc,
        );

        const root = if (try config.getOptional(global, "root", ZigString.Slice)) |slice|
            allocations.track(slice)
        else
            bun.getcwdAlloc(alloc) catch |err| switch (err) {
                error.OutOfMemory => {
                    global.throwOutOfMemory();
                    return error.JSError;
                },
                else => {
                    return global.throwError(err, "while querying current working directory");
                },
            };

        return .{
            .arena = arena.state,
            .allocations = allocations,
            .root = root,
            .framework = framework,
            .bundler_options = bundler_options,
        };
    }
};

/// Each string stores its allocator since some may hold reference counts to JSC
const StringRefList = struct {
    strings: std.ArrayListUnmanaged(ZigString.Slice),

    pub fn track(al: *StringRefList, str: ZigString.Slice) []const u8 {
        al.strings.append(bun.default_allocator, str) catch bun.outOfMemory();
        return str.slice();
    }

    pub fn free(al: *StringRefList) void {
        for (al.strings.items) |item| item.deinit();
        al.strings.clearAndFree(bun.default_allocator);
    }

    pub const empty: StringRefList = .{ .strings = .{} };
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
pub fn jsWipDevServer(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    _ = global;
    _ = callframe;

    if (!bun.FeatureFlags.bake) return .undefined;

    bun.Output.errGeneric(
        \\This api has moved to the `app` property of the default export.
        \\
        \\  export default {{
        \\    port: 3000,
        \\    app: {{
        \\      framework: 'react'
        \\    }},
        \\  }};
        \\
    ,
        .{},
    );
    return .undefined;
}

/// A "Framework" in our eyes is simply set of bundler options that a framework
/// author would set in order to integrate the framework with the application.
/// Since many fields have default values which may point to static memory, this
/// structure is always arena-allocated, usually owned by the arena in `UserOptions`
///
/// Full documentation on these fields is located in the TypeScript definitions.
pub const Framework = struct {
    file_system_router_types: []FileSystemRouterType,
    // static_routers: [][]const u8,
    server_components: ?ServerComponents = null,
    react_fast_refresh: ?ReactFastRefresh = null,
    built_in_modules: bun.StringArrayHashMapUnmanaged(BuiltInModule) = .{},

    /// Bun provides built-in support for using React as a framework.
    /// Depends on externally provided React
    ///
    /// $ bun i react@experimental react-dom@experimental react-server-dom-webpack@experimental react-refresh@experimental
    pub fn react(arena: std.mem.Allocator) !Framework {
        return .{
            .server_components = .{
                .separate_ssr_graph = true,
                .server_runtime_import = "react-server-dom-bun/server",
            },
            .react_fast_refresh = .{},
            .file_system_router_types = try arena.dupe(FileSystemRouterType, &.{
                .{
                    .root = "pages",
                    .prefix = "/",
                    .entry_client = "bun-framework-react/client.tsx",
                    .entry_server = "bun-framework-react/server.tsx",
                    .ignore_underscores = true,
                    .ignore_dirs = &.{ "node_modules", ".git" },
                    .extensions = &.{ ".tsx", ".jsx" },
                    .style = .@"nextjs-pages-ui",
                },
            }),
            // .static_routers = try arena.dupe([]const u8, &.{"public"}),
            .built_in_modules = bun.StringArrayHashMapUnmanaged(BuiltInModule).init(arena, &.{
                "bun-framework-react/client.tsx",
                "bun-framework-react/server.tsx",
                "bun-framework-react/ssr.tsx",
            }, if (Environment.codegen_embed) &.{
                .{ .code = @embedFile("./bun-framework-react/client.tsx") },
                .{ .code = @embedFile("./bun-framework-react/server.tsx") },
                .{ .code = @embedFile("./bun-framework-react/ssr.tsx") },
            } else &.{
                // Cannot use .import because resolution must happen from the user's POV
                .{ .code = bun.runtimeEmbedFile(.src, "bake/bun-framework-react/client.tsx") },
                .{ .code = bun.runtimeEmbedFile(.src, "bake/bun-framework-react/server.tsx") },
                .{ .code = bun.runtimeEmbedFile(.src, "bake/bun-framework-react/ssr.tsx") },
            }) catch bun.outOfMemory(),
        };
    }

    const FileSystemRouterType = struct {
        root: []const u8,
        prefix: []const u8,
        entry_server: []const u8,
        entry_client: ?[]const u8,
        ignore_underscores: bool,
        ignore_dirs: []const []const u8,
        extensions: []const []const u8,
        style: FrameworkRouter.Style,
    };

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

        if (clone.react_fast_refresh) |*react_fast_refresh| {
            f.resolveHelper(client, &react_fast_refresh.import_source, &had_errors, "react refresh runtime");
        }

        if (clone.server_components) |*sc| {
            f.resolveHelper(server, &sc.server_runtime_import, &had_errors, "server components runtime");
            // f.resolveHelper(client, &sc.client_runtime_import, &had_errors);
        }

        for (clone.file_system_router_types) |*fsr| {
            // TODO: unonwned memory
            fsr.root = bun.path.joinAbs(server.fs.top_level_dir, .auto, fsr.root);
            if (fsr.entry_client) |*entry_client| f.resolveHelper(client, entry_client, &had_errors, "client side entrypoint");
            f.resolveHelper(client, &fsr.entry_server, &had_errors, "server side entrypoint");
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
        path.* = result.path().?.text;
    }

    fn fromJS(
        opts: JSValue,
        global: *JSC.JSGlobalObject,
        refs: *StringRefList,
        bundler_options: *SplitBundlerOptions,
        arena: Allocator,
    ) !Framework {
        _ = bundler_options; // autofix
        if (opts.isString()) {
            const str = try opts.toBunString2(global);
            defer str.deref();

            // Deprecated
            if (str.eqlComptime("react-server-components")) {
                bun.Output.warn("deprecation notice: 'react-server-components' will be renamed to 'react'", .{});
                return Framework.react(arena);
            }

            if (str.eqlComptime("react")) {
                return Framework.react(arena);
            }
        }

        if (!opts.isObject()) {
            return global.throwInvalidArguments("Framework must be an object", .{});
        }

        if (try opts.get(global, "serverEntryPoint") != null) {
            bun.Output.warn("deprecation notice: 'framework.serverEntryPoint' has been replaced with 'fileSystemRouterTypes[n].serverEntryPoint'", .{});
        }
        if (try opts.get(global, "clientEntryPoint") != null) {
            bun.Output.warn("deprecation notice: 'framework.clientEntryPoint' has been replaced with 'fileSystemRouterTypes[n].clientEntryPoint'", .{});
        }

        const react_fast_refresh: ?ReactFastRefresh = brk: {
            const rfr: JSValue = try opts.get(global, "reactFastRefresh") orelse
                break :brk null;

            if (rfr == .true) break :brk .{};
            if (rfr == .false or rfr == .null or rfr == .undefined) break :brk null;

            if (!rfr.isObject()) {
                return global.throwInvalidArguments("'framework.reactFastRefresh' must be an object or 'true'", .{});
            }

            const prop = try rfr.get(global, "importSource") orelse {
                return global.throwInvalidArguments("'framework.reactFastRefresh' is missing 'importSource'", .{});
            };

            const str = try prop.toBunString2(global);
            defer str.deref();

            break :brk .{
                .import_source = refs.track(str.toUTF8(arena)),
            };
        };
        const server_components: ?ServerComponents = sc: {
            const sc: JSValue = try opts.get(global, "serverComponents") orelse
                break :sc null;
            if (sc == .false or sc == .null or sc == .undefined) break :sc null;

            if (!sc.isObject()) {
                return global.throwInvalidArguments("'framework.serverComponents' must be an object or 'undefined'", .{});
            }

            break :sc .{
                .separate_ssr_graph = brk: {
                    // Intentionally not using a truthiness check
                    const prop = try sc.getOptional(global, "separateSSRGraph", JSValue) orelse {
                        return global.throwInvalidArguments("Missing 'framework.serverComponents.separateSSRGraph'", .{});
                    };
                    if (prop == .true) break :brk true;
                    if (prop == .false) break :brk false;
                    return global.throwInvalidArguments("'framework.serverComponents.separateSSRGraph' must be a boolean", .{});
                },
                .server_runtime_import = refs.track(
                    try sc.getOptional(global, "serverRuntimeImportSource", ZigString.Slice) orelse {
                        return global.throwInvalidArguments("Missing 'framework.serverComponents.serverRuntimeImportSource'", .{});
                    },
                ),
                .server_register_client_reference = refs.track(
                    try sc.getOptional(global, "serverRegisterClientReferenceExport", ZigString.Slice) orelse {
                        return global.throwInvalidArguments("Missing 'framework.serverComponents.serverRegisterClientReferenceExport'", .{});
                    },
                ),
            };
        };
        const built_in_modules: bun.StringArrayHashMapUnmanaged(BuiltInModule) = built_in_modules: {
            const array = try opts.getArray(global, "builtInModules") orelse
                break :built_in_modules .{};

            const len = array.getLength(global);
            var files: bun.StringArrayHashMapUnmanaged(BuiltInModule) = .{};
            try files.ensureTotalCapacity(arena, len);

            var it = array.arrayIterator(global);
            var i: usize = 0;
            while (it.next()) |file| : (i += 1) {
                if (!file.isObject()) {
                    return global.throwInvalidArguments("'builtInModules[{d}]' is not an object", .{i});
                }

                const path = try getOptionalString(file, global, "import", refs, arena) orelse {
                    return global.throwInvalidArguments("'builtInModules[{d}]' is missing 'import'", .{i});
                };

                const value: BuiltInModule = if (try getOptionalString(file, global, "path", refs, arena)) |str|
                    .{ .import = str }
                else if (try getOptionalString(file, global, "code", refs, arena)) |str|
                    .{ .code = str }
                else
                    return global.throwInvalidArguments("'builtInModules[{d}]' needs either 'path' or 'code'", .{i});

                files.putAssumeCapacity(path, value);
            }

            break :built_in_modules files;
        };
        const file_system_router_types: []FileSystemRouterType = brk: {
            const array: JSValue = try opts.getArray(global, "fileSystemRouterTypes") orelse {
                return global.throwInvalidArguments("Missing 'framework.fileSystemRouterTypes'", .{});
            };
            const len = array.getLength(global);
            if (len > 256) {
                return global.throwInvalidArguments("Framework can only define up to 256 file-system router types", .{});
            }
            const file_system_router_types = try arena.alloc(FileSystemRouterType, len);

            var it = array.arrayIterator(global);
            var i: usize = 0;
            while (it.next()) |fsr_opts| : (i += 1) {
                const root = try getOptionalString(fsr_opts, global, "root", refs, arena) orelse {
                    return global.throwInvalidArguments("'fileSystemRouterTypes[{d}]' is missing 'root'", .{i});
                };
                const server_entry_point = try getOptionalString(fsr_opts, global, "serverEntryPoint", refs, arena) orelse {
                    return global.throwInvalidArguments("'fileSystemRouterTypes[{d}]' is missing 'serverEntryPoint'", .{i});
                };
                const client_entry_point = try getOptionalString(fsr_opts, global, "clientEntryPoint", refs, arena);
                const prefix = try getOptionalString(fsr_opts, global, "prefix", refs, arena) orelse "/";
                const ignore_underscores = try fsr_opts.getBooleanStrict(global, "ignoreUnderscores") orelse false;

                const style = try validators.validateStringEnum(
                    FrameworkRouter.Style,
                    global,
                    try opts.getOptional(global, "style", JSValue) orelse .undefined,
                    "style",
                    .{},
                );

                const extensions: []const []const u8 = if (try fsr_opts.get(global, "extensions")) |exts_js| exts: {
                    if (exts_js.isString()) {
                        const str = try exts_js.toSlice2(global, arena);
                        defer str.deinit();
                        if (bun.strings.eqlComptime(str.slice(), "*")) {
                            break :exts &.{};
                        }
                    } else if (exts_js.isArray()) {
                        var it_2 = array.arrayIterator(global);
                        var i_2: usize = 0;
                        const extensions = try arena.alloc([]const u8, len);
                        while (it_2.next()) |array_item| : (i_2 += 1) {
                            // TODO: remove/add the prefix `.`, throw error if specifying '*' as an array item instead of as root
                            extensions[i_2] = refs.track(try array_item.toSlice2(global, arena));
                        }
                        break :exts extensions;
                    }

                    return global.throwInvalidArguments("'extensions' must be an array of strings or \"*\" for all extensions", .{});
                } else &.{ ".jsx", ".tsx", ".js", ".ts", ".cjs", ".cts", ".mjs", ".mts" };

                const ignore_dirs: []const []const u8 = if (try fsr_opts.get(global, "ignoreDirs")) |exts_js| exts: {
                    if (exts_js.isArray()) {
                        var it_2 = array.arrayIterator(global);
                        var i_2: usize = 0;
                        const dirs = try arena.alloc([]const u8, len);
                        while (it_2.next()) |array_item| : (i_2 += 1) {
                            dirs[i_2] = refs.track(try array_item.toSlice2(global, arena));
                        }
                        break :exts dirs;
                    }

                    return global.throwInvalidArguments("'ignoreDirs' must be an array of strings or \"*\" for all extensions", .{});
                } else &.{ ".git", "node_modules" };

                file_system_router_types[i] = .{
                    .root = root,
                    .prefix = prefix,
                    .style = style,
                    .entry_server = server_entry_point,
                    .entry_client = client_entry_point,
                    .ignore_underscores = ignore_underscores,
                    .extensions = extensions,
                    .ignore_dirs = ignore_dirs,
                };
            }

            break :brk file_system_router_types;
        };

        const framework: Framework = .{
            .file_system_router_types = file_system_router_types,
            .react_fast_refresh = react_fast_refresh,
            .server_components = server_components,
            .built_in_modules = built_in_modules,
        };

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
    allocations: *StringRefList,
    arena: Allocator,
) !?[]const u8 {
    const value = try target.get(global, property) orelse
        return null;
    if (value == .undefined or value == .null)
        return null;
    const str = try value.toBunString2(global);
    return allocations.track(str.toUTF8(arena));
}

export fn Bun__getTemporaryDevServer(global: *JSC.JSGlobalObject) JSValue {
    if (!bun.FeatureFlags.bake) return .undefined;
    return JSC.JSFunction.create(global, "wipDevServer", jsWipDevServer, 0, .{});
}

pub inline fn getHmrRuntime(side: Side) [:0]const u8 {
    return if (Environment.codegen_embed)
        switch (side) {
            .client => @embedFile("bake-codegen/bake.client.js"),
            .server => @embedFile("bake-codegen/bake.server.js"),
        }
    else switch (side) {
        .client => bun.runtimeEmbedFile(.codegen_eager, "bake.client.js"),
        // may not be live-reloaded
        .server => bun.runtimeEmbedFile(.codegen, "bake.server.js"),
    };
}

pub const Mode = enum {
    development,
    production_dynamic,
    production_static,
};
pub const Side = enum(u1) {
    client,
    server,
};
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

/// Stack-allocated structure that is written to from end to start.
/// Used as a staging area for building pattern strings.
pub const PatternBuffer = struct {
    bytes: bun.PathBuffer,
    i: std.math.IntFittingRange(0, @sizeOf(bun.PathBuffer)),

    pub const empty: PatternBuffer = .{
        .bytes = undefined,
        .i = @sizeOf(bun.PathBuffer),
    };

    pub fn prepend(pb: *PatternBuffer, chunk: []const u8) void {
        bun.assert(pb.i >= chunk.len);
        pb.i -= @intCast(chunk.len);
        @memcpy(pb.slice()[0..chunk.len], chunk);
    }

    pub fn prependPart(pb: *PatternBuffer, part: FrameworkRouter.Part) void {
        switch (part) {
            .text => |text| {
                pb.prepend(text);
                pb.prepend("/");
            },
            .param, .catch_all, .catch_all_optional => |name| {
                pb.prepend(name);
                pb.prepend("/:");
            },
            .group => {},
        }
    }

    pub fn slice(pb: *PatternBuffer) []u8 {
        return pb.bytes[pb.i..];
    }
};

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("root").bun;
const Environment = bun.Environment;
const ZigString = bun.JSC.ZigString;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const validators = bun.JSC.Node.validators;
