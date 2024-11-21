//! Implements building a Bake application to production
const log = bun.Output.scoped(.production, false);

pub fn buildCommand(ctx: bun.CLI.Command.Context) !void {
    Output.warn(
        \\Be advised that Bun Bake is highly experimental, and its API
        \\will have breaking changes. Join the <magenta>#bake<r> Discord
        \\channel to help us find bugs: <blue>https://bun.sh/discord<r>
        \\
        \\
    , .{});
    Output.flush();

    if (ctx.args.entry_points.len > 1) {
        Output.errGeneric("bun build --app only accepts one entrypoint", .{});
        bun.Global.crash();
    }

    if (ctx.debug.hot_reload != .none) {
        Output.errGeneric("Instead of using --watch, use 'bun run'", .{});
        bun.Global.crash();
    }

    var cwd_buf: bun.PathBuffer = undefined;
    const cwd = bun.getcwd(&cwd_buf) catch |err| {
        Output.err(err, "Could not query current working directory", .{});
        bun.Global.crash();
    };

    // Create a VM + global for loading the config file, plugins, and
    // performing build time prerendering.
    bun.JSC.initialize(false);
    bun.JSAst.Expr.Data.Store.create();
    bun.JSAst.Stmt.Data.Store.create();

    var arena = try bun.MimallocArena.init();
    defer arena.deinit();

    const vm = try VirtualMachine.initBake(.{
        .allocator = arena.allocator(),
        .log = ctx.log,
        .args = ctx.args,
        .smol = ctx.runtime_options.smol,
    });
    defer vm.deinit();
    vm.global = BakeCreateProdGlobal(vm.console);
    vm.regular_event_loop.global = vm.global;
    vm.jsc = vm.global.vm();
    vm.event_loop.ensureWaker();
    const b = &vm.bundler;
    vm.preload = ctx.preloads;
    vm.argv = ctx.passthrough;
    vm.arena = &arena;
    vm.allocator = arena.allocator();
    b.options.install = ctx.install;
    b.resolver.opts.install = ctx.install;
    b.resolver.opts.global_cache = ctx.debug.global_cache;
    b.resolver.opts.prefer_offline_install = (ctx.debug.offline_mode_setting orelse .online) == .offline;
    b.resolver.opts.prefer_latest_install = (ctx.debug.offline_mode_setting orelse .online) == .latest;
    b.options.global_cache = b.resolver.opts.global_cache;
    b.options.prefer_offline_install = b.resolver.opts.prefer_offline_install;
    b.options.prefer_latest_install = b.resolver.opts.prefer_latest_install;
    b.resolver.env_loader = b.env;
    b.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
    b.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
    b.options.ignore_dce_annotations = ctx.bundler_options.ignore_dce_annotations;
    b.resolver.opts.minify_identifiers = ctx.bundler_options.minify_identifiers;
    b.resolver.opts.minify_whitespace = ctx.bundler_options.minify_whitespace;
    b.options.env.behavior = .load_all_without_inlining;
    vm.event_loop.ensureWaker();
    switch (ctx.debug.macros) {
        .disable => {
            b.options.no_macros = true;
        },
        .map => |macros| {
            b.options.macro_remap = macros;
        },
        .unspecified => {},
    }
    b.configureDefines() catch {
        bun.bun_js.failWithBuildError(vm);
    };
    bun.http.AsyncHTTP.loadEnv(vm.allocator, vm.log, b.env);
    vm.loadExtraEnvAndSourceCodePrinter();
    vm.is_main_thread = true;
    JSC.VirtualMachine.is_main_thread_vm = true;

    const api_lock = vm.jsc.getAPILock();
    defer api_lock.release();
    buildWithVm(ctx, cwd, vm) catch |err| switch (err) {
        error.JSError => |e| {
            bun.handleErrorReturnTrace(err, @errorReturnTrace());
            vm.printErrorLikeObjectToConsole(vm.global.takeException(e));
            if (vm.exit_handler.exit_code == 0) {
                vm.exit_handler.exit_code = 1;
            }
            vm.globalExit();
        },
        else => |e| return e,
    };
}

pub fn buildWithVm(ctx: bun.CLI.Command.Context, cwd: []const u8, vm: *VirtualMachine) !void {
    // Load and evaluate the configuration module
    const global = vm.global;
    const b = &vm.bundler;
    const allocator = bun.default_allocator;

    Output.prettyErrorln("Loading configuration", .{});
    Output.flush();
    const unresolved_config_entry_point = if (ctx.args.entry_points.len > 0) ctx.args.entry_points[0] else "./bun.app";

    const config_entry_point = b.resolver.resolve(cwd, unresolved_config_entry_point, .entry_point) catch |err| {
        if (err == error.ModuleNotFound) {
            if (ctx.args.entry_points.len == 0) {
                // Onboarding message
                Output.err(err,
                    \\'bun build --app' cannot find your application's config file
                    \\
                    \\The default location for this is `bun.app.ts`
                    \\
                    \\TODO: insert a link to `bun.sh/docs`
                , .{});
                bun.Global.crash();
            }
        }

        Output.err(err, "could not resolve application config file '{s}'", .{unresolved_config_entry_point});
        bun.Global.crash();
    };

    const config_entry_point_string = bun.String.createUTF8(config_entry_point.pathConst().?.text);
    defer config_entry_point_string.deref();

    const config_promise = bun.JSC.JSModuleLoader.loadAndEvaluateModule(global, &config_entry_point_string) orelse {
        bun.assert(global.hasException());
        return error.JSError;
    };

    vm.waitForPromise(.{ .internal = config_promise });
    var options = switch (config_promise.unwrap(vm.jsc, .mark_handled)) {
        .pending => unreachable,
        .fulfilled => |resolved| config: {
            bun.assert(resolved == .undefined);
            const default = BakeGetDefaultExportFromModule(vm.global, config_entry_point_string.toJS(vm.global));

            if (!default.isObject()) {
                Output.panic("TODO: print this error better, default export is not an object", .{});
            }

            const app = try default.get(vm.global, "app") orelse {
                Output.panic("TODO: print this error better, default export needs an 'app' object", .{});
            };

            break :config try bake.UserOptions.fromJS(app, vm.global);
        },
        .rejected => |err| {
            // dont run on rejected since we fail the build here
            vm.printErrorLikeObjectToConsole(err);
            if (vm.exit_handler.exit_code == 0) {
                vm.exit_handler.exit_code = 1;
            }
            vm.globalExit();
        },
    };

    const framework = &options.framework;

    const separate_ssr_graph = if (framework.server_components) |sc| sc.separate_ssr_graph else false;

    // this is probably wrong
    const map = try allocator.create(bun.DotEnv.Map);
    map.* = bun.DotEnv.Map.init(allocator);
    const loader = try allocator.create(bun.DotEnv.Loader);
    loader.* = bun.DotEnv.Loader.init(map, allocator);
    try loader.map.put("NODE_ENV", "production");
    bun.DotEnv.instance = loader;

    var client_bundler: bun.bundler.Bundler = undefined;
    var server_bundler: bun.bundler.Bundler = undefined;
    var ssr_bundler: bun.bundler.Bundler = undefined;
    try framework.initBundler(allocator, vm.log, .production_static, .server, &server_bundler);
    try framework.initBundler(allocator, vm.log, .production_static, .client, &client_bundler);
    if (separate_ssr_graph) {
        try framework.initBundler(allocator, vm.log, .production_static, .ssr, &ssr_bundler);
    }

    // these share pointers right now, so setting NODE_ENV == production on one should affect all
    bun.assert(server_bundler.env == client_bundler.env);

    framework.* = framework.resolve(&server_bundler.resolver, &client_bundler.resolver) catch {
        Output.errGeneric("Failed to resolve all imports required by the framework", .{});
        bun.Global.crash();
    };

    Output.prettyErrorln("Bundling routes", .{});
    Output.flush();

    // trailing slash
    const public_path = "/";

    var root_dir_buf: bun.PathBuffer = undefined;
    const root_dir_path = bun.path.joinAbsStringBuf(cwd, &root_dir_buf, &.{"dist"}, .auto);
    // const root_path_trailing = root_dir_path.ptr[0 .. root_dir_path.len + 1];
    // root_dir_buf[root_dir_path.len] = std.fs.path.sep;
    // _ = root_path_trailing;

    var router_types = try std.ArrayListUnmanaged(FrameworkRouter.Type).initCapacity(allocator, options.framework.file_system_router_types.len);

    var path_map: ProductionPathMap = .{
        .allocator = allocator,
        .entry_points = .{},
        .route_files = .{},
        .out_index_map = &.{},
        .out_module_keys = &.{},
    };

    for (options.framework.file_system_router_types, 0..) |fsr, i| {
        const joined_root = bun.path.joinAbs(cwd, .auto, fsr.root);
        const entry = server_bundler.resolver.readDirInfoIgnoreError(joined_root) orelse
            continue;
        try router_types.append(allocator, .{
            .abs_root = bun.strings.withoutTrailingSlash(entry.abs_path),
            .prefix = fsr.prefix,
            .ignore_underscores = fsr.ignore_underscores,
            .ignore_dirs = fsr.ignore_dirs,
            .extensions = fsr.extensions,
            .style = fsr.style,
            .server_file = try path_map.getFileIdForRouter(fsr.entry_server, FrameworkRouter.Route.Index.init(@intCast(i)), .page),
            .client_file = if (fsr.entry_client) |client|
                (try path_map.getClientFile(client)).toOptional()
            else
                .none,
            .server_file_string = .{},
        });
    }

    var router = try FrameworkRouter.initEmpty(router_types.items, allocator);
    try router.scanAll(
        allocator,
        &server_bundler.resolver,
        FrameworkRouter.InsertionContext.wrap(ProductionPathMap, &path_map),
    );

    const bundled_outputs_list = try bun.BundleV2.generateFromBakeProductionCLI(
        path_map.entry_points.items,
        &server_bundler,
        .{
            .framework = framework.*,
            .client_bundler = &client_bundler,
            .ssr_bundler = if (separate_ssr_graph) &ssr_bundler else &server_bundler,
        },
        allocator,
        .{ .js = vm.event_loop },
    );
    const bundled_outputs = bundled_outputs_list.items;

    Output.prettyErrorln("Rendering routes", .{});
    Output.flush();

    var root_dir = try std.fs.cwd().makeOpenPath("dist", .{});
    defer root_dir.close();

    var css_chunks_count: usize = 0;
    var css_chunks_first: usize = 0;

    path_map.out_index_map = try allocator.alloc(u32, path_map.entry_points.items.len);
    path_map.out_module_keys = try allocator.alloc(JSValue, bundled_outputs.len);
    @memset(path_map.out_module_keys, .undefined);
    const all_server_files = JSValue.createEmptyArray(global, bundled_outputs.len);

    for (bundled_outputs, 0..) |file, i| {
        log("{s} - {s} : {s} - {?d}\n", .{
            if (file.side) |s| @tagName(s) else "null",
            file.src_path.text,
            file.dest_path,
            file.entry_point_index,
        });
        if (file.loader == .css) {
            if (css_chunks_count == 0) css_chunks_first = i;
            css_chunks_count += 1;
        }

        if (file.entry_point_index) |entry_point| {
            if (entry_point < path_map.out_index_map.len) {
                path_map.out_index_map[entry_point] = @intCast(i);
            }
        }

        switch (file.side orelse .client) {
            .client => {
                // Client-side resources will be written to disk for usage in on the client side
                _ = try file.writeToDisk(root_dir, root_dir_path);
            },
            .server => {
                // For Debugging
                if (ctx.bundler_options.bake_debug_dump_server)
                    _ = try file.writeToDisk(root_dir, root_dir_path);

                switch (file.output_kind) {
                    .@"entry-point", .chunk => {
                        const without_prefix = if (bun.strings.hasPrefixComptime(file.dest_path, "./") or
                            (Environment.isWindows and bun.strings.hasPrefixComptime(file.dest_path, ".\\")))
                            file.dest_path[2..]
                        else
                            file.dest_path;

                        // TODO: later we can lazily register modules
                        const module_key = BakeRegisterProductionChunk(
                            global,
                            try bun.String.createFormat("bake:/{s}", .{without_prefix}),
                            file.value.toBunString(),
                        ) catch |err| {
                            Output.errGeneric("could not load bundled chunk {} for server-side rendering", .{
                                bun.fmt.quote(without_prefix),
                            });
                            return err;
                        };
                        bun.assert(module_key.isString());
                        if (file.entry_point_index != null) {
                            path_map.out_module_keys[i] = module_key;
                            all_server_files.putIndex(global, @intCast(i), module_key);
                        }
                    },
                    .asset => {},
                    .bytecode => {},
                    .sourcemap => @panic("TODO: register source map"),
                }
            },
        }
    }

    // Static site generator
    const server_render_funcs = JSValue.createEmptyArray(global, router.types.len);
    const client_entry_urls = JSValue.createEmptyArray(global, router.types.len);

    for (router.types, 0..) |router_type, i| {
        if (router_type.client_file.unwrap()) |client_file| {
            const str = (try bun.String.createFormat("{s}{s}", .{
                public_path,
                bundled_outputs[path_map.getOutIndex(client_file)].dest_path,
            })).toJS(global);
            client_entry_urls.putIndex(global, @intCast(i), str);
        } else {
            client_entry_urls.putIndex(global, @intCast(i), .null);
        }

        const server_entry_module_key = path_map.out_module_keys[path_map.getOutIndex(router_type.server_file)];
        bun.assert(server_entry_module_key != .undefined);
        const server_entry_point = try loadModule(vm, global, server_entry_module_key);
        const server_render_func = brk: {
            const raw = BakeGetOnModuleNamespace(global, server_entry_point, "prerender") orelse
                break :brk null;
            if (!raw.isCallable(vm.jsc)) {
                break :brk null;
            }
            break :brk raw;
        } orelse {
            Output.errGeneric("Framework does not support static site generation", .{});
            Output.note("The file {s} is missing the \"prerender\" export, which defines how to generate static files.", .{
                bun.fmt.quote(path_map.route_files.keys()[router_type.server_file.get()]),
            });
            bun.Global.crash();
        };
        server_render_funcs.putIndex(global, @intCast(i), server_render_func);
    }

    var navigatable_routes = std.ArrayList(FrameworkRouter.Route.Index).init(allocator);
    for (router.routes.items, 0..) |route, i| {
        _ = route.file_page.unwrap() orelse continue;
        try navigatable_routes.append(FrameworkRouter.Route.Index.init(@intCast(i)));
    }

    const css_chunk_js_strings = try allocator.alloc(JSValue, css_chunks_count);
    for (bundled_outputs[css_chunks_first..][0..css_chunks_count], css_chunk_js_strings) |output_file, *str| {
        bun.assert(output_file.dest_path[0] != '.');
        bun.assert(output_file.loader == .css);
        str.* = (try bun.String.createFormat("{s}{s}", .{ public_path, output_file.dest_path })).toJS(global);
    }

    const route_patterns = JSValue.createEmptyArray(global, navigatable_routes.items.len);
    const route_nested_files = JSValue.createEmptyArray(global, navigatable_routes.items.len);
    const route_type_and_flags = JSValue.createEmptyArray(global, navigatable_routes.items.len);
    const route_source_files = JSValue.createEmptyArray(global, navigatable_routes.items.len);
    const route_param_info = JSValue.createEmptyArray(global, navigatable_routes.items.len);
    const route_style_references = JSValue.createEmptyArray(global, navigatable_routes.items.len);

    var params_buf: std.ArrayListUnmanaged([]const u8) = .{};
    for (navigatable_routes.items, 0..) |route_index, nav_index| {
        defer params_buf.clearRetainingCapacity();

        var pattern = bake.PatternBuffer.empty;

        const route = router.routePtr(route_index);
        const main_file_route_index = route.file_page.unwrap().?;
        const main_file_index = path_map.getOutIndex(main_file_route_index);

        pattern.prependPart(route.part);

        var file_count: u32 = 1;
        var css_file_count: u32 = @intCast(bundled_outputs[main_file_index].referenced_css_files.len);
        if (route.file_layout.unwrap()) |file| {
            css_file_count += @intCast(bundled_outputs[path_map.getOutIndex(file)].referenced_css_files.len);
            file_count += 1;
        }
        var next: ?FrameworkRouter.Route.Index = route.parent.unwrap();
        while (next) |parent_index| {
            const parent = router.routePtr(parent_index);
            pattern.prependPart(parent.part);
            if (parent.file_layout.unwrap()) |file| {
                css_file_count += @intCast(bundled_outputs[path_map.getOutIndex(file)].referenced_css_files.len);
                file_count += 1;
            }
            next = parent.parent.unwrap();
        }
        const styles = JSValue.createEmptyArray(global, css_chunks_count);
        const file_list = JSValue.createEmptyArray(global, file_count);
        next = route.parent.unwrap();
        file_count = 1;
        css_file_count = 0;
        file_list.putIndex(global, 0, JSValue.jsNumberFromInt32(@intCast(main_file_route_index.get())));
        for (bundled_outputs[main_file_index].referenced_css_files) |ref| {
            styles.putIndex(global, css_file_count, css_chunk_js_strings[ref.get() - css_chunks_first]);
            css_file_count += 1;
        }
        if (route.file_layout.unwrap()) |file| {
            file_list.putIndex(global, file_count, JSValue.jsNumberFromInt32(@intCast(file.get())));
            for (bundled_outputs[path_map.getOutIndex(file)].referenced_css_files) |ref| {
                styles.putIndex(global, css_file_count, css_chunk_js_strings[ref.get() - css_chunks_first]);
                css_file_count += 1;
            }
            file_count += 1;
        }
        while (next) |parent_index| {
            const parent = router.routePtr(parent_index);
            if (parent.file_layout.unwrap()) |file| {
                file_list.putIndex(global, file_count, JSValue.jsNumberFromInt32(@intCast(file.get())));
                for (bundled_outputs[path_map.getOutIndex(file)].referenced_css_files) |ref| {
                    styles.putIndex(global, css_file_count, css_chunk_js_strings[ref.get() - css_chunks_first]);
                    css_file_count += 1;
                }
                file_count += 1;
            }
            next = parent.parent.unwrap();
        }

        var pattern_string = bun.String.createUTF8(pattern.slice());
        defer pattern_string.deref();
        route_patterns.putIndex(global, @intCast(nav_index), pattern_string.toJS(global));

        var src_path = bun.String.createUTF8(bun.path.relative(cwd, path_map.route_files.keys()[main_file_route_index.get()]));
        route_source_files.putIndex(global, @intCast(nav_index), src_path.transferToJS(global));

        route_nested_files.putIndex(global, @intCast(nav_index), file_list);
        route_type_and_flags.putIndex(global, @intCast(nav_index), JSValue.jsNumberFromInt32(@bitCast(TypeAndFlags{
            .type = route.type.get(),
        })));
        route_param_info.putIndex(global, @intCast(nav_index), .null);
        route_style_references.putIndex(global, @intCast(nav_index), styles);
    }

    const render_promise = BakeRenderRoutesForProdStatic(
        global,
        bun.String.init(root_dir_path),
        all_server_files,
        server_render_funcs,
        client_entry_urls,

        route_patterns,
        route_nested_files,
        route_type_and_flags,
        route_source_files,
        route_param_info,
        route_style_references,
    );
    vm.waitForPromise(.{ .normal = render_promise });
    switch (render_promise.unwrap(vm.jsc, .mark_handled)) {
        .pending => unreachable,
        .fulfilled => {
            Output.prettyln("done", .{});
            Output.flush();
        },
        .rejected => |err| {
            vm.global.throwValue(err);
            return error.JSError;
        },
    }
}

/// unsafe function, must be run outside of the event loop
/// quits the process on exception
fn loadModule(vm: *VirtualMachine, global: *JSC.JSGlobalObject, key: JSValue) !JSValue {
    const promise = BakeLoadModuleByKey(global, key).asAnyPromise().?.internal;
    vm.waitForPromise(.{ .internal = promise });
    switch (promise.unwrap(vm.jsc, .mark_handled)) {
        .pending => unreachable,
        .fulfilled => |val| {
            bun.assert(val == .undefined);
            return BakeGetModuleNamespace(global, key);
        },
        .rejected => |err| {
            vm.global.throwValue(err);
            return error.JSError;
        },
    }
}

// extern apis:

// TODO: Dedupe
extern fn BakeGetDefaultExportFromModule(global: *JSC.JSGlobalObject, key: JSValue) JSValue;
extern fn BakeGetModuleNamespace(global: *JSC.JSGlobalObject, key: JSValue) JSValue;
extern fn BakeLoadModuleByKey(global: *JSC.JSGlobalObject, key: JSValue) JSValue;

fn BakeGetOnModuleNamespace(global: *JSC.JSGlobalObject, module: JSValue, property: []const u8) ?JSValue {
    const f = @extern(*const fn (*JSC.JSGlobalObject, JSValue, [*]const u8, usize) callconv(.C) JSValue, .{
        .name = "BakeGetOnModuleNamespace",
    });
    const result: JSValue = f(global, module, property.ptr, property.len);
    bun.assert(result != .zero);
    return result;
}

extern fn BakeRenderRoutesForProdStatic(
    *JSC.JSGlobalObject,
    out_base: bun.String,
    all_server_files: JSValue,
    render_static: JSValue,
    client_entry_urls: JSValue,
    patterns: JSValue,
    files: JSValue,
    type_and_flags: JSValue,
    src_route_files: JSValue,
    param_information: JSValue,
    styles: JSValue,
) *JSC.JSPromise;

extern fn BakeCreateProdGlobal(console_ptr: *anyopaque) *JSC.JSGlobalObject;

/// The result of this function is a JSValue that wont be garbage collected, as
/// it will always have at least one reference by the module loader.
fn BakeRegisterProductionChunk(global: *JSC.JSGlobalObject, key: bun.String, source_code: bun.String) bun.JSError!JSValue {
    const f = @extern(*const fn (*JSC.JSGlobalObject, bun.String, bun.String) callconv(.C) JSValue, .{
        .name = "BakeRegisterProductionChunk",
    });
    const result: JSValue = f(global, key, source_code);
    if (result == .zero) return error.JSError;
    bun.assert(result.isString());
    return result;
}

export fn BakeProdResolve(global: *JSC.JSGlobalObject, a_str: bun.String, specifier_str: bun.String) callconv(.C) bun.String {
    var sfa = std.heap.stackFallback(@sizeOf(bun.PathBuffer) * 2, bun.default_allocator);
    const alloc = sfa.get();

    const specifier = specifier_str.toUTF8(alloc);
    defer specifier.deinit();

    if (JSC.HardcodedModule.Aliases.get(specifier.slice(), .bun)) |alias| {
        return bun.String.static(alias.path);
    }

    const referrer = a_str.toUTF8(alloc);
    defer referrer.deinit();

    if (bun.resolver.isPackagePath(specifier.slice())) {
        global.throw("Non-relative import {} from {} are not allowed in production assets. This is a bug in Bun's bundler", .{
            bun.fmt.quote(specifier.slice()),
            bun.fmt.quote(referrer.slice()),
        });
        return bun.String.dead;
    }

    if (Environment.allow_assert)
        bun.assert(bun.strings.hasPrefix(referrer.slice(), "bake:"));

    return bun.String.createFormat("bake:{s}", .{bun.path.joinAbs(
        bun.Dirname.dirname(u8, referrer.slice()[5..]) orelse referrer.slice()[5..],
        .auto,
        specifier.slice(),
    )}) catch return bun.String.dead;
}

/// Tracks all entry points for a production bundle
const ProductionPathMap = struct {
    allocator: std.mem.Allocator,

    entry_points: std.ArrayListUnmanaged(BakeEntryPoint),
    route_files: bun.StringArrayHashMapUnmanaged(void),
    /// OpaqueFileId -> index into output_files
    out_index_map: []u32,
    /// index into output_files -> key to load them in JavaScript
    out_module_keys: []JSValue,

    const RouteType = struct {
        client_file: FrameworkRouter.OpaqueFileId.Optional,
        server_file: FrameworkRouter.OpaqueFileId,
    };

    fn getOutIndex(ppm: *ProductionPathMap, index: FrameworkRouter.OpaqueFileId) u32 {
        return ppm.out_index_map[index.get()];
    }

    pub fn getFileIdForRouter(ctx: *ProductionPathMap, abs_path: []const u8, _: FrameworkRouter.Route.Index, _: FrameworkRouter.Route.FileKind) !FrameworkRouter.OpaqueFileId {
        const gop = try ctx.route_files.getOrPut(ctx.allocator, abs_path);
        if (!gop.found_existing) {
            const dupe = try ctx.allocator.dupe(u8, abs_path);
            try ctx.entry_points.append(ctx.allocator, BakeEntryPoint.init(dupe, .server));
            gop.key_ptr.* = dupe;
            gop.value_ptr.* = {};
        }
        return FrameworkRouter.OpaqueFileId.init(@intCast(gop.index));
    }

    pub fn getClientFile(ctx: *ProductionPathMap, abs_path: []const u8) !FrameworkRouter.OpaqueFileId {
        // Bug: if server and client reference the same file, it is impossible to know which side it was already queued for, leading to a missing output file.
        const gop = try ctx.route_files.getOrPut(ctx.allocator, abs_path);
        if (!gop.found_existing) {
            const dupe = try ctx.allocator.dupe(u8, abs_path);
            try ctx.entry_points.append(ctx.allocator, BakeEntryPoint.initClientWrapped(dupe, .client));
            gop.key_ptr.* = dupe;
            gop.value_ptr.* = {};
        }
        return FrameworkRouter.OpaqueFileId.init(@intCast(gop.index));
    }
};

const TypeAndFlags = packed struct(i32) {
    type: u8,
    unused: u24 = 0,
};

const std = @import("std");

const bun = @import("root").bun;
const Environment = bun.Environment;
const Output = bun.Output;
const BakeEntryPoint = bun.bundle_v2.BakeEntryPoint;
const OutputFile = bun.options.OutputFile;

const bake = bun.bake;
const FrameworkRouter = bake.FrameworkRouter;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const VirtualMachine = JSC.VirtualMachine;
