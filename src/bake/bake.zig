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
    /// This arena contains some miscellaneous allocations at startup
    arena: std.heap.ArenaAllocator,
    allocations: StringRefList,

    root: [:0]const u8,
    framework: Framework,
    bundler_options: SplitBundlerOptions,

    pub fn deinit(options: *UserOptions) void {
        options.arena.deinit();
        options.allocations.free();
        if (options.bundler_options.plugin) |p| p.deinit();
    }

    /// Currently, this function must run at the top of the event loop.
    pub fn fromJS(config: JSValue, global: *JSC.JSGlobalObject) !UserOptions {
        if (!config.isObject()) {
            return global.throwInvalidArguments("'" ++ api_name ++ "' is not an object", .{});
        }
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        errdefer arena.deinit();
        const alloc = arena.allocator();

        var allocations = StringRefList.empty;
        errdefer allocations.free();
        var bundler_options = SplitBundlerOptions.empty;

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
                    return global.throwOutOfMemory();
                },
                else => {
                    return global.throwError(err, "while querying current working directory");
                },
            };

        if (try config.get(global, "plugins")) |plugin_array| {
            try bundler_options.parsePluginArray(plugin_array, global);
        }

        return .{
            .arena = arena,
            .allocations = allocations,
            .root = try alloc.dupeZ(u8, root),
            .framework = framework,
            .bundler_options = bundler_options,
        };
    }
};

/// Each string stores its allocator since some may hold reference counts to JSC
pub const StringRefList = struct {
    strings: std.ArrayListUnmanaged(ZigString.Slice),

    pub const empty: StringRefList = .{ .strings = .{} };

    pub fn track(al: *StringRefList, str: ZigString.Slice) []const u8 {
        al.strings.append(bun.default_allocator, str) catch bun.outOfMemory();
        return str.slice();
    }

    pub fn free(al: *StringRefList) void {
        for (al.strings.items) |item| item.deinit();
        al.strings.clearAndFree(bun.default_allocator);
    }
};

pub const SplitBundlerOptions = struct {
    plugin: ?*Plugin = null,
    client: BuildConfigSubset = .{},
    server: BuildConfigSubset = .{},
    ssr: BuildConfigSubset = .{},

    pub const empty: SplitBundlerOptions = .{
        .plugin = null,
        .client = .{},
        .server = .{},
        .ssr = .{},
    };

    pub fn parsePluginArray(opts: *SplitBundlerOptions, plugin_array: JSValue, global: *JSC.JSGlobalObject) bun.JSError!void {
        const plugin = opts.plugin orelse Plugin.create(global, .bun);
        opts.plugin = plugin;
        const empty_object = JSValue.createEmptyObject(global, 0);

        var iter = try plugin_array.arrayIterator(global);
        while (try iter.next()) |plugin_config| {
            if (!plugin_config.isObject()) {
                return global.throwInvalidArguments("Expected plugin to be an object", .{});
            }

            if (try plugin_config.getOptional(global, "name", ZigString.Slice)) |slice| {
                defer slice.deinit();
                if (slice.len == 0) {
                    return global.throwInvalidArguments("Expected plugin to have a non-empty name", .{});
                }
            } else {
                return global.throwInvalidArguments("Expected plugin to have a name", .{});
            }

            const function = try plugin_config.getFunction(global, "setup") orelse {
                return global.throwInvalidArguments("Expected plugin to have a setup() function", .{});
            };
            const plugin_result = try plugin.addPlugin(function, empty_object, .null, false, true);
            if (plugin_result.asAnyPromise()) |promise| {
                promise.setHandled(global.vm());
                // TODO: remove this call, replace with a promise list that must
                // be resolved before the first bundle task can begin.
                global.bunVM().waitForPromise(promise);
                switch (promise.unwrap(global.vm(), .mark_handled)) {
                    .pending => unreachable,
                    .fulfilled => |val| {
                        _ = val;
                    },
                    .rejected => |err| {
                        return global.throwValue(err);
                    },
                }
            }
        }
    }
};

const BuildConfigSubset = struct {
    loader: ?bun.Schema.Api.LoaderMap = null,
    ignoreDCEAnnotations: ?bool = null,
    conditions: bun.StringArrayHashMapUnmanaged(void) = .{},
    drop: bun.StringArrayHashMapUnmanaged(void) = .{},
    env: bun.Schema.Api.DotEnvBehavior = ._none,
    env_prefix: ?[]const u8 = null,
    define: bun.Schema.Api.StringMap = .{ .keys = &.{}, .values = &.{} },
};

/// A "Framework" in our eyes is simply set of bundler options that a framework
/// author would set in order to integrate the framework with the application.
/// Since many fields have default values which may point to static memory, this
/// structure is always arena-allocated, usually owned by the arena in `UserOptions`
///
/// Full documentation on these fields is located in the TypeScript definitions.
pub const Framework = struct {
    is_built_in_react: bool,
    file_system_router_types: []FileSystemRouterType,
    // static_routers: [][]const u8,
    server_components: ?ServerComponents = null,
    react_fast_refresh: ?ReactFastRefresh = null,
    built_in_modules: bun.StringArrayHashMapUnmanaged(BuiltInModule) = .{},

    /// Bun provides built-in support for using React as a framework.
    /// Depends on externally provided React
    ///
    /// $ bun i react@experimental react-dom@experimental react-refresh@experimental react-server-dom-bun
    pub fn react(arena: std.mem.Allocator) !Framework {
        return .{
            .is_built_in_react = true,
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
                    .style = .nextjs_pages,
                    .allow_layouts = true,
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

    /// Default that requires no packages or configuration.
    /// - If `react-refresh` is installed, enable react fast refresh with it.
    ///     - Otherwise, if `react` is installed, use a bundled copy of
    ///     react-refresh so that it still works.
    /// - If any file system router types are provided, configure using
    ///   the above react configuration.
    /// The provided allocator is not stored.
    pub fn auto(
        arena: std.mem.Allocator,
        resolver: *bun.resolver.Resolver,
        file_system_router_types: []FileSystemRouterType,
    ) !Framework {
        var fw: Framework = Framework.none;

        if (file_system_router_types.len > 0) {
            fw = try react(arena);
            arena.free(fw.file_system_router_types);
            fw.file_system_router_types = file_system_router_types;
        }

        if (resolveOrNull(resolver, "react-refresh/runtime")) |rfr| {
            fw.react_fast_refresh = .{ .import_source = rfr };
        } else if (resolveOrNull(resolver, "react")) |_| {
            fw.react_fast_refresh = .{ .import_source = "react-refresh/runtime/index.js" };
            try fw.built_in_modules.put(
                arena,
                "react-refresh/runtime/index.js",
                if (Environment.codegen_embed)
                    .{ .code = @embedFile("node-fallbacks/react-refresh.js") }
                else
                    .{ .code = bun.runtimeEmbedFile(.codegen, "node-fallbacks/react-refresh.js") },
            );
        }

        return fw;
    }

    /// Unopiniated default.
    pub const none: Framework = .{
        .is_built_in_react = false,
        .file_system_router_types = &.{},
        .server_components = null,
        .react_fast_refresh = null,
        .built_in_modules = .empty,
    };

    pub const FileSystemRouterType = struct {
        root: []const u8,
        prefix: []const u8,
        entry_server: []const u8,
        entry_client: ?[]const u8,
        ignore_underscores: bool,
        ignore_dirs: []const []const u8,
        extensions: []const []const u8,
        style: FrameworkRouter.Style,
        allow_layouts: bool,
    };

    pub const BuiltInModule = union(enum) {
        import: []const u8,
        code: []const u8,
    };

    pub const ServerComponents = struct {
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

    pub const react_install_command = "bun i react@experimental react-dom@experimental react-server-dom-bun";

    pub fn addReactInstallCommandNote(log: *bun.logger.Log) !void {
        try log.addMsg(.{
            .kind = .note,
            .data = try bun.logger.rangeData(null, bun.logger.Range.none, "Install the built in react integration with \"" ++ react_install_command ++ "\"")
                .cloneLineText(log.clone_line_text, log.msgs.allocator),
        });
    }

    /// Given a Framework configuration, this returns another one with all paths resolved.
    /// New memory allocated into provided arena.
    ///
    /// All resolution errors will happen before returning error.ModuleNotFound
    /// Errors written into `r.log`
    pub fn resolve(f: Framework, server: *bun.resolver.Resolver, client: *bun.resolver.Resolver, arena: Allocator) !Framework {
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
            fsr.root = try arena.dupe(u8, bun.path.joinAbs(server.fs.top_level_dir, .auto, fsr.root));
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

    inline fn resolveOrNull(r: *bun.resolver.Resolver, path: []const u8) ?[]const u8 {
        return (r.resolve(r.fs.top_level_dir, path, .stmt) catch {
            r.log.reset();
            return null;
        }).pathConst().?.text;
    }

    fn fromJS(
        opts: JSValue,
        global: *JSC.JSGlobalObject,
        refs: *StringRefList,
        bundler_options: *SplitBundlerOptions,
        arena: Allocator,
    ) bun.JSError!Framework {
        if (opts.isString()) {
            const str = try opts.toBunString(global);
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
            if (rfr == .false or rfr.isUndefinedOrNull()) break :brk null;

            if (!rfr.isObject()) {
                return global.throwInvalidArguments("'framework.reactFastRefresh' must be an object or 'true'", .{});
            }

            const prop = try rfr.get(global, "importSource") orelse {
                return global.throwInvalidArguments("'framework.reactFastRefresh' is missing 'importSource'", .{});
            };

            const str = try prop.toBunString(global);
            defer str.deref();

            break :brk .{
                .import_source = refs.track(str.toUTF8(arena)),
            };
        };
        const server_components: ?ServerComponents = sc: {
            const sc: JSValue = try opts.get(global, "serverComponents") orelse
                break :sc null;
            if (sc == .false or sc.isUndefinedOrNull()) break :sc null;

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
                .server_register_client_reference = if (try sc.getOptional(
                    global,
                    "serverRegisterClientReferenceExport",
                    ZigString.Slice,
                )) |slice|
                    refs.track(slice)
                else
                    "registerClientReference",
            };
        };
        const built_in_modules: bun.StringArrayHashMapUnmanaged(BuiltInModule) = built_in_modules: {
            const array = try opts.getArray(global, "builtInModules") orelse
                break :built_in_modules .{};

            const len = try array.getLength(global);
            var files: bun.StringArrayHashMapUnmanaged(BuiltInModule) = .{};
            try files.ensureTotalCapacity(arena, len);

            var it = try array.arrayIterator(global);
            var i: usize = 0;
            while (try it.next()) |file| : (i += 1) {
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
            const len = try array.getLength(global);
            if (len > 256) {
                return global.throwInvalidArguments("Framework can only define up to 256 file-system router types", .{});
            }
            const file_system_router_types = try arena.alloc(FileSystemRouterType, len);

            var it = try array.arrayIterator(global);
            var i: usize = 0;
            errdefer for (file_system_router_types[0..i]) |*fsr| fsr.style.deinit();
            while (try it.next()) |fsr_opts| : (i += 1) {
                const root = try getOptionalString(fsr_opts, global, "root", refs, arena) orelse {
                    return global.throwInvalidArguments("'fileSystemRouterTypes[{d}]' is missing 'root'", .{i});
                };
                const server_entry_point = try getOptionalString(fsr_opts, global, "serverEntryPoint", refs, arena) orelse {
                    return global.throwInvalidArguments("'fileSystemRouterTypes[{d}]' is missing 'serverEntryPoint'", .{i});
                };
                const client_entry_point = try getOptionalString(fsr_opts, global, "clientEntryPoint", refs, arena);
                const prefix = try getOptionalString(fsr_opts, global, "prefix", refs, arena) orelse "/";
                const ignore_underscores = try fsr_opts.getBooleanStrict(global, "ignoreUnderscores") orelse false;
                const layouts = try fsr_opts.getBooleanStrict(global, "layouts") orelse false;

                var style = try FrameworkRouter.Style.fromJS(try fsr_opts.get(global, "style") orelse {
                    return global.throwInvalidArguments("'fileSystemRouterTypes[{d}]' is missing 'style'", .{i});
                }, global);
                errdefer style.deinit();

                const extensions: []const []const u8 = if (try fsr_opts.get(global, "extensions")) |exts_js| exts: {
                    if (exts_js.isString()) {
                        const str = try exts_js.toSlice(global, arena);
                        defer str.deinit();
                        if (bun.strings.eqlComptime(str.slice(), "*")) {
                            break :exts &.{};
                        }
                    } else if (exts_js.isArray()) {
                        var it_2 = try exts_js.arrayIterator(global);
                        var i_2: usize = 0;
                        const extensions = try arena.alloc([]const u8, try exts_js.getLength(global));
                        while (try it_2.next()) |array_item| : (i_2 += 1) {
                            const slice = refs.track(try array_item.toSlice(global, arena));
                            if (bun.strings.eqlComptime(slice, "*"))
                                return global.throwInvalidArguments("'extensions' cannot include \"*\" as an extension. Pass \"*\" instead of the array.", .{});

                            if (slice.len == 0) {
                                return global.throwInvalidArguments("'extensions' cannot include \"\" as an extension.", .{});
                            }

                            extensions[i_2] = if (slice[0] == '.')
                                slice
                            else
                                try std.mem.concat(arena, u8, &.{ ".", slice });
                        }
                        break :exts extensions;
                    }

                    return global.throwInvalidArguments("'extensions' must be an array of strings or \"*\" for all extensions", .{});
                } else &.{ ".jsx", ".tsx", ".js", ".ts", ".cjs", ".cts", ".mjs", ".mts" };

                const ignore_dirs: []const []const u8 = if (try fsr_opts.get(global, "ignoreDirs")) |exts_js| exts: {
                    if (exts_js.isArray()) {
                        var it_2 = try array.arrayIterator(global);
                        var i_2: usize = 0;
                        const dirs = try arena.alloc([]const u8, len);
                        while (try it_2.next()) |array_item| : (i_2 += 1) {
                            dirs[i_2] = refs.track(try array_item.toSlice(global, arena));
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
                    .allow_layouts = layouts,
                };
            }

            break :brk file_system_router_types;
        };
        errdefer for (file_system_router_types) |*fsr| fsr.style.deinit();

        const framework: Framework = .{
            .is_built_in_react = false,
            .file_system_router_types = file_system_router_types,
            .react_fast_refresh = react_fast_refresh,
            .server_components = server_components,
            .built_in_modules = built_in_modules,
        };

        if (try opts.getOptional(global, "plugins", JSValue)) |plugin_array| {
            try bundler_options.parsePluginArray(plugin_array, global);
        }

        if (try opts.getOptional(global, "bundlerOptions", JSValue)) |js_options| {
            _ = js_options; // TODO:
            // try bundler_options.parseInto(global, js_options, .root);
        }

        return framework;
    }

    pub fn initTranspiler(
        framework: *Framework,
        arena: std.mem.Allocator,
        log: *bun.logger.Log,
        mode: Mode,
        renderer: Graph,
        out: *bun.transpiler.Transpiler,
        bundler_options: *const BuildConfigSubset,
    ) !void {
        const JSAst = bun.JSAst;

        var ast_memory_allocator: JSAst.ASTMemoryAllocator = undefined;
        ast_memory_allocator.initWithoutStack(arena);
        var ast_scope = JSAst.ASTMemoryAllocator.Scope{
            .previous = JSAst.Stmt.Data.Store.memory_allocator,
            .current = &ast_memory_allocator,
        };
        ast_scope.enter();
        defer ast_scope.exit();

        out.* = try bun.Transpiler.init(
            arena,
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

        out.options.conditions = try bun.options.ESMConditions.init(arena, out.options.target.defaultConditions());
        if (renderer == .server and framework.server_components != null) {
            try out.options.conditions.appendSlice(&.{"react-server"});
        }
        if (mode == .development) {
            // Support `esm-env` package using this condition.
            try out.options.conditions.appendSlice(&.{"development"});
        }
        if (bundler_options.conditions.count() > 0) {
            try out.options.conditions.appendSlice(bundler_options.conditions.keys());
        }

        out.options.production = mode != .development;
        out.options.tree_shaking = mode != .development;
        out.options.minify_syntax = mode != .development;
        out.options.minify_identifiers = mode != .development;
        out.options.minify_whitespace = mode != .development;
        out.options.css_chunking = true;
        out.options.framework = framework;
        out.options.inline_entrypoint_import_meta_main = true;
        if (bundler_options.ignoreDCEAnnotations) |ignore|
            out.options.ignore_dce_annotations = ignore;

        out.options.source_map = switch (mode) {
            // Source maps must always be external, as DevServer special cases
            // the linking and part of the generation of these. It also relies
            // on source maps always being enabled.
            .development => .external,
            // TODO: follow user configuration
            else => .none,
        };
        if (bundler_options.env != ._none) {
            out.options.env.behavior = bundler_options.env;
            out.options.env.prefix = bundler_options.env_prefix orelse "";
        }
        out.resolver.opts = out.options;

        out.configureLinker();
        try out.configureDefines();

        out.options.jsx.development = mode == .development;

        try addImportMetaDefines(arena, out.options.define, mode, switch (renderer) {
            .client => .client,
            .server, .ssr => .server,
        });

        if ((bundler_options.define.keys.len + bundler_options.drop.count()) > 0) {
            for (bundler_options.define.keys, bundler_options.define.values) |k, v| {
                const parsed = try bun.options.Define.Data.parse(k, v, false, false, log, arena);
                try out.options.define.insert(arena, k, parsed);
            }

            for (bundler_options.drop.keys()) |drop_item| {
                if (drop_item.len > 0) {
                    const parsed = try bun.options.Define.Data.parse(drop_item, "", true, true, log, arena);
                    try out.options.define.insert(arena, drop_item, parsed);
                }
            }
        }

        if (mode != .development) {
            // Hide information about the source repository, at the cost of debugging quality.
            out.options.entry_naming = "_bun/[hash].[ext]";
            out.options.chunk_naming = "_bun/[hash].[ext]";
            out.options.asset_naming = "_bun/[hash].[ext]";
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
    if (value.isUndefinedOrNull())
        return null;
    const str = try value.toBunString(global);
    return allocations.track(str.toUTF8(arena));
}

pub const HmrRuntime = struct {
    code: [:0]const u8,
    /// The number of lines in the HMR runtime. This is used for sourcemap
    /// generation, where the first n lines are skipped. In release, these
    /// are always precalculated.
    line_count: u32,

    pub fn init(code: [:0]const u8) HmrRuntime {
        return .{
            .code = code,
            .line_count = @intCast(std.mem.count(u8, code, "\n")),
        };
    }
};

pub fn getHmrRuntime(side: Side) callconv(bun.callconv_inline) HmrRuntime {
    return if (Environment.codegen_embed)
        switch (side) {
            .client => .init(@embedFile("bake-codegen/bake.client.js")),
            .server => .init(@embedFile("bake-codegen/bake.server.js")),
        }
    else
        .init(switch (side) {
            .client => bun.runtimeEmbedFile(.codegen_eager, "bake.client.js"),
            // server runtime is loaded once, so it is pointless to make this eager.
            .server => bun.runtimeEmbedFile(.codegen, "bake.server.js"),
        });
}

pub const Mode = enum {
    development,
    production_dynamic,
    production_static,
};
pub const Side = enum(u1) {
    client,
    server,

    pub fn graph(s: Side) Graph {
        return switch (s) {
            .client => .client,
            .server => .server,
        };
    }
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
                bun.assert(text.len == 0 or text[0] != '/');
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

pub fn printWarning() void {
    // Silence this for the test suite
    if (bun.getenvZ("BUN_DEV_SERVER_TEST_RUNNER") == null) {
        bun.Output.warn(
            \\Be advised that Bun Bake is highly experimental, and its API
            \\will have breaking changes. Join the <magenta>#bake<r> Discord
            \\channel to help us find bugs: <blue>https://bun.sh/discord<r>
            \\
            \\
        , .{});
        bun.Output.flush();
    }
}

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Environment = bun.Environment;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;
const Plugin = JSC.API.JSBundler.Plugin;
