//! Implements building a Bake application to production
const log = bun.Output.scoped(.production, false);

pub fn buildCommand(ctx: bun.CLI.Command.Context) !void {
    bun.bake.printWarning();

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
    // A special global object is used to allow registering virtual modules
    // that bypass Bun's normal module resolver and plugin system.
    vm.global = BakeCreateProdGlobal(vm.console);
    vm.regular_event_loop.global = vm.global;
    vm.jsc = vm.global.vm();
    vm.event_loop.ensureWaker();
    const b = &vm.transpiler;
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
            const err_value = vm.global.takeException(e);
            vm.printErrorLikeObjectToConsole(err_value.toError() orelse err_value);
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
    const b = &vm.transpiler;
    const allocator = bun.default_allocator;

    Output.prettyErrorln("Loading configuration", .{});
    Output.flush();
    var unresolved_config_entry_point = if (ctx.args.entry_points.len > 0) ctx.args.entry_points[0] else "./bun.app";
    if (bun.resolver.isPackagePath(unresolved_config_entry_point)) {
        unresolved_config_entry_point = try std.fmt.allocPrint(ctx.allocator, "./{s}", .{unresolved_config_entry_point});
    }

    const config_entry_point = b.resolver.resolve(cwd, unresolved_config_entry_point, .entry_point_build) catch |err| {
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

    config_promise.setHandled(vm.jsc);
    vm.waitForPromise(.{ .internal = config_promise });
    var options = switch (config_promise.unwrap(vm.jsc, .mark_handled)) {
        .pending => unreachable,
        .fulfilled => |resolved| config: {
            bun.assert(resolved.isUndefined());
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
            return global.throwValue(err.toError() orelse err);
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

    var client_transpiler: bun.transpiler.Transpiler = undefined;
    var server_transpiler: bun.transpiler.Transpiler = undefined;
    var ssr_transpiler: bun.transpiler.Transpiler = undefined;
    try framework.initTranspiler(allocator, vm.log, .production_static, .server, &server_transpiler, &options.bundler_options.server);
    try framework.initTranspiler(allocator, vm.log, .production_static, .client, &client_transpiler, &options.bundler_options.client);
    if (separate_ssr_graph) {
        try framework.initTranspiler(allocator, vm.log, .production_static, .ssr, &ssr_transpiler, &options.bundler_options.ssr);
    }

    if (ctx.bundler_options.bake_debug_disable_minify) {
        for ([_]*bun.transpiler.Transpiler{ &client_transpiler, &server_transpiler, &ssr_transpiler }) |transpiler| {
            transpiler.options.minify_syntax = false;
            transpiler.options.minify_identifiers = false;
            transpiler.options.minify_whitespace = false;
            transpiler.resolver.opts.entry_naming = "_bun/[dir]/[name].[hash].[ext]";
            transpiler.resolver.opts.chunk_naming = "_bun/[dir]/[name].[hash].chunk.[ext]";
            transpiler.resolver.opts.asset_naming = "_bun/[dir]/[name].[hash].asset.[ext]";
        }
    }

    // these share pointers right now, so setting NODE_ENV == production on one should affect all
    bun.assert(server_transpiler.env == client_transpiler.env);

    framework.* = framework.resolve(&server_transpiler.resolver, &client_transpiler.resolver, allocator) catch {
        if (framework.is_built_in_react)
            try bake.Framework.addReactInstallCommandNote(server_transpiler.log);
        Output.errGeneric("Failed to resolve all imports required by the framework", .{});
        Output.flush();
        server_transpiler.log.print(Output.errorWriter()) catch {};
        bun.Global.crash();
    };

    Output.prettyErrorln("Bundling routes", .{});
    Output.flush();

    // trailing slash
    const public_path = "/";

    var root_dir_buf: bun.PathBuffer = undefined;
    const root_dir_path = bun.path.joinAbsStringBuf(cwd, &root_dir_buf, &.{"dist"}, .auto);

    var router_types = try std.ArrayListUnmanaged(FrameworkRouter.Type).initCapacity(allocator, options.framework.file_system_router_types.len);

    var entry_points: EntryPointMap = .{
        .root = cwd,
        .allocator = allocator,
        .files = .{},
    };

    for (options.framework.file_system_router_types) |fsr| {
        const joined_root = bun.path.joinAbs(cwd, .auto, fsr.root);
        const entry = server_transpiler.resolver.readDirInfoIgnoreError(joined_root) orelse
            continue;
        try router_types.append(allocator, .{
            .abs_root = bun.strings.withoutTrailingSlashWindowsPath(entry.abs_path),
            .prefix = fsr.prefix,
            .ignore_underscores = fsr.ignore_underscores,
            .ignore_dirs = fsr.ignore_dirs,
            .extensions = fsr.extensions,
            .style = fsr.style,
            .allow_layouts = fsr.allow_layouts,
            .server_file = try entry_points.getOrPutEntryPoint(fsr.entry_server, .server),
            .client_file = if (fsr.entry_client) |client|
                (try entry_points.getOrPutEntryPoint(client, .client)).toOptional()
            else
                .none,
            .server_file_string = .empty,
        });
    }

    var router = try FrameworkRouter.initEmpty(cwd, router_types.items, allocator);
    try router.scanAll(
        allocator,
        &server_transpiler.resolver,
        FrameworkRouter.InsertionContext.wrap(EntryPointMap, &entry_points),
    );

    const bundled_outputs_list = try bun.BundleV2.generateFromBakeProductionCLI(
        entry_points,
        &server_transpiler,
        .{
            .framework = framework.*,
            .client_transpiler = &client_transpiler,
            .ssr_transpiler = if (separate_ssr_graph) &ssr_transpiler else &server_transpiler,
            .plugins = options.bundler_options.plugin,
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

    // Index all bundled outputs.
    // Client files go to disk.
    // Server files get loaded in memory.
    // Populate indexes in `entry_points` to be looked up during prerendering
    const module_keys = try vm.allocator.alloc(bun.String, entry_points.files.count());
    const output_indexes = entry_points.files.values();
    var output_module_map: bun.StringArrayHashMapUnmanaged(OutputFile.Index) = .{};
    @memset(module_keys, bun.String.dead);
    for (bundled_outputs, 0..) |file, i| {
        log("{s} - {s} : {s} - {?d}\n", .{
            if (file.side) |s| @tagName(s) else "null",
            file.src_path.text,
            file.dest_path,
            file.entry_point_index,
        });
        if (file.loader.isCSS()) {
            if (css_chunks_count == 0) css_chunks_first = i;
            css_chunks_count += 1;
        }

        if (file.entry_point_index) |entry_point| {
            if (entry_point < output_indexes.len) {
                output_indexes[entry_point] = OutputFile.Index.init(@intCast(i));
            }
        }

        switch (file.side orelse continue) {
            .client => {
                // Client-side resources will be written to disk for usage in on the client side
                _ = file.writeToDisk(root_dir, ".") catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());
                    Output.err(err, "Failed to write {} to output directory", .{bun.fmt.quote(file.dest_path)});
                };
            },
            .server => {
                // For Debugging
                if (ctx.bundler_options.bake_debug_dump_server) {
                    _ = file.writeToDisk(root_dir, ".") catch |err| {
                        bun.handleErrorReturnTrace(err, @errorReturnTrace());
                        Output.err(err, "Failed to write {} to output directory", .{bun.fmt.quote(file.dest_path)});
                    };
                }

                switch (file.output_kind) {
                    .@"entry-point", .chunk => {
                        const without_prefix = if (bun.strings.hasPrefixComptime(file.dest_path, "./") or
                            (Environment.isWindows and bun.strings.hasPrefixComptime(file.dest_path, ".\\")))
                            file.dest_path[2..]
                        else
                            file.dest_path;

                        if (file.entry_point_index) |entry_point_index| {
                            if (entry_point_index < module_keys.len) {
                                var str = try bun.String.createFormat("bake:/{s}", .{without_prefix});
                                str.toThreadSafe();
                                module_keys[entry_point_index] = str;
                            }
                        }

                        try output_module_map.put(
                            allocator,
                            try std.fmt.allocPrint(allocator, "bake:/{s}", .{without_prefix}),
                            OutputFile.Index.init(@intCast(i)),
                        );
                    },
                    .asset => {},
                    .bytecode => {},
                    .sourcemap => @panic("TODO: register source map"),
                }
            },
        }
    }

    const per_thread_options: PerThread.Options = .{
        .input_files = entry_points.files.keys(),
        .bundled_outputs = bundled_outputs,
        .output_indexes = output_indexes,
        .module_keys = module_keys,
        .module_map = output_module_map,
    };

    var pt = try PerThread.init(vm, per_thread_options);
    pt.attach();

    // Static site generator
    const server_render_funcs = try JSValue.createEmptyArray(global, router.types.len);
    const server_param_funcs = try JSValue.createEmptyArray(global, router.types.len);
    const client_entry_urls = try JSValue.createEmptyArray(global, router.types.len);

    for (router.types, 0..) |router_type, i| {
        if (router_type.client_file.unwrap()) |client_file| {
            const str = (try bun.String.createFormat("{s}{s}", .{
                public_path,
                pt.outputFile(client_file).dest_path,
            })).toJS(global);
            client_entry_urls.putIndex(global, @intCast(i), str);
        } else {
            client_entry_urls.putIndex(global, @intCast(i), .null);
        }

        const server_entry_point = try pt.loadBundledModule(router_type.server_file);
        const server_render_func = brk: {
            const raw = BakeGetOnModuleNamespace(global, server_entry_point, "prerender") orelse
                break :brk null;
            if (!raw.isCallable()) {
                break :brk null;
            }
            break :brk raw;
        } orelse {
            Output.errGeneric("Framework does not support static site generation", .{});
            Output.note("The file {s} is missing the \"prerender\" export, which defines how to generate static files.", .{
                bun.fmt.quote(bun.path.relative(cwd, entry_points.files.keys()[router_type.server_file.get()].absPath())),
            });
            bun.Global.crash();
        };

        const server_param_func = if (router.dynamic_routes.count() > 0)
            brk: {
                const raw = BakeGetOnModuleNamespace(global, server_entry_point, "getParams") orelse
                    break :brk null;
                if (!raw.isCallable()) {
                    break :brk null;
                }
                break :brk raw;
            } orelse {
                Output.errGeneric("Framework does not support static site generation", .{});
                Output.note("The file {s} is missing the \"getParams\" export, which defines how to generate static files.", .{
                    bun.fmt.quote(bun.path.relative(cwd, entry_points.files.keys()[router_type.server_file.get()].absPath())),
                });
                bun.Global.crash();
            }
        else
            JSValue.null;
        server_render_funcs.putIndex(global, @intCast(i), server_render_func);
        server_param_funcs.putIndex(global, @intCast(i), server_param_func);
    }

    var navigatable_routes = std.ArrayList(FrameworkRouter.Route.Index).init(allocator);
    for (router.routes.items, 0..) |route, i| {
        _ = route.file_page.unwrap() orelse continue;
        try navigatable_routes.append(FrameworkRouter.Route.Index.init(@intCast(i)));
    }

    const css_chunk_js_strings = try allocator.alloc(JSValue, css_chunks_count);
    for (bundled_outputs[css_chunks_first..][0..css_chunks_count], css_chunk_js_strings) |output_file, *str| {
        bun.assert(output_file.dest_path[0] != '.');
        bun.assert(output_file.loader.isCSS());
        str.* = (try bun.String.createFormat("{s}{s}", .{ public_path, output_file.dest_path })).toJS(global);
    }

    const route_patterns = try JSValue.createEmptyArray(global, navigatable_routes.items.len);
    const route_nested_files = try JSValue.createEmptyArray(global, navigatable_routes.items.len);
    const route_type_and_flags = try JSValue.createEmptyArray(global, navigatable_routes.items.len);
    const route_source_files = try JSValue.createEmptyArray(global, navigatable_routes.items.len);
    const route_param_info = try JSValue.createEmptyArray(global, navigatable_routes.items.len);
    const route_style_references = try JSValue.createEmptyArray(global, navigatable_routes.items.len);

    var params_buf: std.ArrayListUnmanaged([]const u8) = .{};
    for (navigatable_routes.items, 0..) |route_index, nav_index| {
        defer params_buf.clearRetainingCapacity();

        var pattern = bake.PatternBuffer.empty;

        const route = router.routePtr(route_index);
        const main_file_route_index = route.file_page.unwrap().?;
        const main_file = pt.outputFile(main_file_route_index);

        // Count how many JS+CSS files associated with this route and prepare `pattern`
        pattern.prependPart(route.part);
        switch (route.part) {
            .param => {
                params_buf.append(ctx.allocator, route.part.param) catch unreachable;
            },
            .catch_all, .catch_all_optional => {
                return global.throw("catch-all routes are not supported in static site generation", .{});
            },
            else => {},
        }
        var file_count: u32 = 1;
        var css_file_count: u32 = @intCast(main_file.referenced_css_files.len);
        if (route.file_layout.unwrap()) |file| {
            css_file_count += @intCast(pt.outputFile(file).referenced_css_files.len);
            file_count += 1;
        }
        var next: ?FrameworkRouter.Route.Index = route.parent.unwrap();
        while (next) |parent_index| {
            const parent = router.routePtr(parent_index);
            pattern.prependPart(parent.part);
            switch (parent.part) {
                .param => {
                    params_buf.append(ctx.allocator, parent.part.param) catch unreachable;
                },
                .catch_all, .catch_all_optional => {
                    return global.throw("catch-all routes are not supported in static site generation", .{});
                },
                else => {},
            }
            if (parent.file_layout.unwrap()) |file| {
                css_file_count += @intCast(pt.outputFile(file).referenced_css_files.len);
                file_count += 1;
            }
            next = parent.parent.unwrap();
        }

        // Fill styles and file_list
        const styles = try JSValue.createEmptyArray(global, css_chunks_count);
        const file_list = try JSValue.createEmptyArray(global, file_count);

        next = route.parent.unwrap();
        file_count = 1;
        css_file_count = 0;
        file_list.putIndex(global, 0, pt.preloadBundledModule(main_file_route_index));
        for (main_file.referenced_css_files) |ref| {
            styles.putIndex(global, css_file_count, css_chunk_js_strings[ref.get() - css_chunks_first]);
            css_file_count += 1;
        }
        if (route.file_layout.unwrap()) |file| {
            file_list.putIndex(global, file_count, pt.preloadBundledModule(file));
            for (pt.outputFile(file).referenced_css_files) |ref| {
                styles.putIndex(global, css_file_count, css_chunk_js_strings[ref.get() - css_chunks_first]);
                css_file_count += 1;
            }
            file_count += 1;
        }

        while (next) |parent_index| {
            const parent = router.routePtr(parent_index);
            if (parent.file_layout.unwrap()) |file| {
                file_list.putIndex(global, file_count, pt.preloadBundledModule(file));
                for (pt.outputFile(file).referenced_css_files) |ref| {
                    styles.putIndex(global, css_file_count, css_chunk_js_strings[ref.get() - css_chunks_first]);
                    css_file_count += 1;
                }
                file_count += 1;
            }
            next = parent.parent.unwrap();
        }

        // Init the items
        var pattern_string = bun.String.createUTF8(pattern.slice());
        defer pattern_string.deref();
        route_patterns.putIndex(global, @intCast(nav_index), pattern_string.toJS(global));

        var src_path = bun.String.createUTF8(bun.path.relative(cwd, pt.inputFile(main_file_route_index).absPath()));
        route_source_files.putIndex(global, @intCast(nav_index), src_path.transferToJS(global));

        route_nested_files.putIndex(global, @intCast(nav_index), file_list);
        route_type_and_flags.putIndex(global, @intCast(nav_index), JSValue.jsNumberFromInt32(@bitCast(TypeAndFlags{
            .type = route.type.get(),
        })));

        if (params_buf.items.len > 0) {
            const param_info_array = try JSValue.createEmptyArray(global, params_buf.items.len);
            for (params_buf.items, 0..) |param, i| {
                param_info_array.putIndex(global, @intCast(params_buf.items.len - i - 1), bun.String.createUTF8ForJS(global, param));
            }
            route_param_info.putIndex(global, @intCast(nav_index), param_info_array);
        } else {
            route_param_info.putIndex(global, @intCast(nav_index), .null);
        }
        route_style_references.putIndex(global, @intCast(nav_index), styles);
    }

    const render_promise = BakeRenderRoutesForProdStatic(
        global,
        bun.String.init(root_dir_path),
        pt.all_server_files,
        server_render_funcs,
        server_param_funcs,
        client_entry_urls,

        route_patterns,
        route_nested_files,
        route_type_and_flags,
        route_source_files,
        route_param_info,
        route_style_references,
    );
    render_promise.setHandled(vm.jsc);
    vm.waitForPromise(.{ .normal = render_promise });
    switch (render_promise.unwrap(vm.jsc, .mark_handled)) {
        .pending => unreachable,
        .fulfilled => {
            Output.prettyln("done", .{});
            Output.flush();
        },
        .rejected => |err| {
            return vm.global.throwValue(err);
        },
    }
}

/// unsafe function, must be run outside of the event loop
/// quits the process on exception
fn loadModule(vm: *VirtualMachine, global: *JSC.JSGlobalObject, key: JSValue) !JSValue {
    const promise = BakeLoadModuleByKey(global, key).asAnyPromise().?.internal;
    promise.setHandled(vm.jsc);
    vm.waitForPromise(.{ .internal = promise });
    switch (promise.unwrap(vm.jsc, .mark_handled)) {
        .pending => unreachable,
        .fulfilled => |val| {
            bun.assert(val.isUndefined());
            return BakeGetModuleNamespace(global, key);
        },
        .rejected => |err| {
            return vm.global.throwValue(err);
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
    get_params: JSValue,
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

pub export fn BakeProdResolve(global: *JSC.JSGlobalObject, a_str: bun.String, specifier_str: bun.String) callconv(.C) bun.String {
    var sfa = std.heap.stackFallback(@sizeOf(bun.PathBuffer) * 2, bun.default_allocator);
    const alloc = sfa.get();

    const specifier = specifier_str.toUTF8(alloc);
    defer specifier.deinit();

    if (JSC.ModuleLoader.HardcodedModule.Alias.get(specifier.slice(), .bun)) |alias| {
        return bun.String.static(alias.path);
    }

    const referrer = a_str.toUTF8(alloc);
    defer referrer.deinit();

    if (bun.resolver.isPackagePath(specifier.slice())) {
        return global.throw("Non-relative import {} from {} are not allowed in production assets. This is a bug in Bun's bundler", .{
            bun.fmt.quote(specifier.slice()),
            bun.fmt.quote(referrer.slice()),
        }) catch bun.String.dead;
    }

    if (Environment.allow_assert)
        bun.assert(bun.strings.hasPrefix(referrer.slice(), "bake:"));

    return bun.String.createFormat("bake:{s}", .{bun.path.joinAbs(
        bun.Dirname.dirname(u8, referrer.slice()[5..]) orelse referrer.slice()[5..],
        .auto,
        specifier.slice(),
    )}) catch return bun.String.dead;
}

/// After a production bundle is generated, prerendering needs to be able to
/// look up the generated chunks associated with each route's `OpaqueFileId`
/// This data structure contains that mapping, and is also used by bundle_v2
/// to enqueue the entry points.
pub const EntryPointMap = struct {
    root: []const u8,

    allocator: std.mem.Allocator,
    /// OpaqueFileId refers to the index in this map.
    /// Values are left uninitialized until after the bundle is done and indexed.
    files: HashMap,

    const HashMap = std.ArrayHashMapUnmanaged(InputFile, OutputFile.Index, InputFile.ArrayHashContext, true);

    /// This approach is used instead of what DevServer does so that each
    /// distinct file gets its own index.
    const InputFile = struct {
        abs_path_ptr: [*]const u8,
        abs_path_len: u32,
        side: bake.Side,

        pub fn init(abs_path: []const u8, side: bake.Side) InputFile {
            return .{
                .abs_path_ptr = abs_path.ptr,
                .abs_path_len = @intCast(abs_path.len),
                .side = side,
            };
        }

        pub fn absPath(key: InputFile) []const u8 {
            return key.abs_path_ptr[0..key.abs_path_len];
        }

        const ArrayHashContext = struct {
            pub fn hash(_: @This(), key: InputFile) u32 {
                return bun.hash32(key.absPath()) +% @intFromEnum(key.side);
            }

            pub fn eql(_: @This(), a: InputFile, b: InputFile, _: usize) bool {
                return a.side == b.side and bun.strings.eql(a.absPath(), b.absPath());
            }
        };
    };

    pub fn getOrPutEntryPoint(map: *EntryPointMap, abs_path: []const u8, side: bake.Side) !OpaqueFileId {
        const k = InputFile.init(abs_path, side);
        const gop = try map.files.getOrPut(map.allocator, k);
        if (!gop.found_existing) {
            errdefer map.files.swapRemoveAt(gop.index);
            gop.key_ptr.* = InputFile.init(try map.allocator.dupe(u8, abs_path), side);
        }
        return OpaqueFileId.init(@intCast(gop.index));
    }

    pub fn getFileIdForRouter(map: *EntryPointMap, abs_path: []const u8, _: FrameworkRouter.Route.Index, _: FrameworkRouter.Route.FileKind) !FrameworkRouter.OpaqueFileId {
        return map.getOrPutEntryPoint(abs_path, .server);
    }

    pub fn onRouterCollisionError(dev: *EntryPointMap, rel_path: []const u8, other_id: OpaqueFileId, ty: FrameworkRouter.Route.FileKind) bun.OOM!void {
        Output.errGeneric("Multiple {s} matching the same route pattern is ambiguous", .{
            switch (ty) {
                .page => "pages",
                .layout => "layout",
            },
        });
        Output.prettyErrorln("  - <blue>{s}<r>", .{rel_path});
        Output.prettyErrorln("  - <blue>{s}<r>", .{
            bun.path.relative(dev.root, dev.files.keys()[other_id.get()].absPath()),
        });
        Output.flush();
    }
};

/// Data used on each rendering thread. Contains all information in the bundle needed to render.
/// This is referred to as `pt` in variable/field naming, and Bake::ProductionPerThread in C++
pub const PerThread = struct {
    // Shared Data
    input_files: []const EntryPointMap.InputFile,
    bundled_outputs: []const OutputFile,
    /// Indexed by entry point index (OpaqueFileId)
    output_indexes: []const OutputFile.Index,
    /// Indexed by entry point index (OpaqueFileId)
    module_keys: []const bun.String,
    /// Unordered
    module_map: bun.StringArrayHashMapUnmanaged(OutputFile.Index),

    // Thread-local
    vm: *JSC.VirtualMachine,
    /// Indexed by entry point index (OpaqueFileId)
    loaded_files: bun.bit_set.AutoBitSet,
    /// JSArray of JSString, indexed by entry point index (OpaqueFileId)
    all_server_files: JSC.JSValue,

    /// Sent to other threads for rendering
    pub const Options = struct {
        input_files: []const EntryPointMap.InputFile,
        bundled_outputs: []const OutputFile,
        /// Indexed by entry point index (OpaqueFileId)
        output_indexes: []const OutputFile.Index,
        /// Indexed by entry point index (OpaqueFileId)
        module_keys: []const bun.String,
        /// Unordered
        module_map: bun.StringArrayHashMapUnmanaged(OutputFile.Index),
    };

    extern fn BakeGlobalObject__attachPerThreadData(global: *JSC.JSGlobalObject, pt: ?*PerThread) void;

    /// After initializing, call `attach`
    pub fn init(vm: *VirtualMachine, opts: Options) !PerThread {
        var loaded_files = try bun.bit_set.AutoBitSet.initEmpty(vm.allocator, opts.output_indexes.len);
        errdefer loaded_files.deinit(vm.allocator);

        const all_server_files = try JSValue.createEmptyArray(vm.global, opts.output_indexes.len);
        all_server_files.protect();

        return .{
            .input_files = opts.input_files,
            .bundled_outputs = opts.bundled_outputs,
            .output_indexes = opts.output_indexes,
            .module_keys = opts.module_keys,
            .module_map = opts.module_map,
            .vm = vm,
            .loaded_files = loaded_files,
            .all_server_files = all_server_files,
        };
    }

    pub fn attach(pt: *PerThread) void {
        BakeGlobalObject__attachPerThreadData(pt.vm.global, pt);
    }

    pub fn deinit(pt: *PerThread) void {
        BakeGlobalObject__attachPerThreadData(pt.vm.global, null);
        pt.all_server_files.unprotect();
    }

    pub fn outputIndex(s: PerThread, id: OpaqueFileId) OutputFile.Index {
        return s.output_indexes[id.get()];
    }

    pub fn inputFile(s: PerThread, id: OpaqueFileId) EntryPointMap.InputFile {
        return s.input_files[id.get()];
    }

    pub fn outputFile(s: PerThread, id: OpaqueFileId) *const OutputFile {
        return &s.bundled_outputs[s.outputIndex(id).get()];
    }

    // Must be run at the top of the event loop
    pub fn loadBundledModule(pt: *PerThread, id: OpaqueFileId) bun.JSError!JSValue {
        return try loadModule(
            pt.vm,
            pt.vm.global,
            pt.module_keys[id.get()].toJS(pt.vm.global),
        );
    }

    /// The JSString entries in `all_server_files` is generated lazily. When
    /// multiple rendering threads are used, unreferenced files will contain
    /// holes in the array used. Returns a JSValue of the "FileIndex" type
    //
    // What could be done here is generating a new index type, which is
    // specifically for referenced files. This would remove the holes, but make
    // it harder to pre-allocate. It's probably worth it.
    pub fn preloadBundledModule(pt: *PerThread, id: OpaqueFileId) JSValue {
        if (!pt.loaded_files.isSet(id.get())) {
            pt.loaded_files.set(id.get());
            pt.all_server_files.putIndex(
                pt.vm.global,
                @intCast(id.get()),
                pt.module_keys[id.get()].toJS(pt.vm.global),
            );
        }

        return JSValue.jsNumberFromInt32(@intCast(id.get()));
    }
};

/// Given a key, returns the source code to load.
pub export fn BakeProdLoad(pt: *PerThread, key: bun.String) bun.String {
    var sfa = std.heap.stackFallback(4096, bun.default_allocator);
    const allocator = sfa.get();
    const utf8 = key.toUTF8(allocator);
    defer utf8.deinit();
    if (pt.module_map.get(utf8.slice())) |value| {
        return pt.bundled_outputs[value.get()].value.toBunString();
    }
    return bun.String.dead;
}

const TypeAndFlags = packed struct(i32) {
    type: u8,
    unused: u24 = 0,
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const OutputFile = bun.options.OutputFile;

const bake = bun.bake;
const FrameworkRouter = bake.FrameworkRouter;
const OpaqueFileId = FrameworkRouter.OpaqueFileId;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const VirtualMachine = JSC.VirtualMachine;

fn @"export"() void {
    _ = BakeProdResolve;
    _ = BakeProdLoad;
}
