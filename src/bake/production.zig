//! Implements building to production

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

extern fn BakeRenderRoutesForProd(*JSC.JSGlobalObject, out_base: bun.String, render_static_cb: JSValue, arr: JSValue) *JSC.JSPromise;

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
    const cwd = try bun.getcwd(&cwd_buf);

    // Create a VM + global for loading the config file, plugins, and
    // performing build time prerendering.
    bun.JSC.initialize(false);
    bun.JSAst.Expr.Data.Store.create();
    bun.JSAst.Stmt.Data.Store.create();
    var arena = try bun.MimallocArena.init();
    defer arena.deinit();
    const allocator = bun.default_allocator;
    const vm = try VirtualMachine.init(.{
        .allocator = arena.allocator(),
        .log = ctx.log,
        .args = ctx.args,
        .smol = ctx.runtime_options.smol,
    });
    defer vm.deinit();
    var b = &vm.bundler;
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

    // Load and evaluate the configuration module
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

    const str = bun.String.createUTF8(config_entry_point.pathConst().?.text);
    defer str.deref();
    const config_promise = bun.JSC.JSModuleLoader.loadAndEvaluateModule(vm.global, &str) orelse {
        @panic("TODO");
    };
    vm.waitForPromise(.{ .internal = config_promise });
    var options = switch (config_promise.unwrap(vm.jsc, .mark_handled)) {
        .pending => unreachable,
        .fulfilled => |resolved| config: {
            bun.assert(resolved == .undefined);
            const default = BakeGetDefaultExportFromModule(vm.global, str.toJS(vm.global));

            if (!default.isObject()) {
                Output.panic("TODO: print this error better, default export is not an object", .{});
            }

            const app = default.get(vm.global, "app") orelse {
                Output.panic("TODO: print this error better, default export needs an 'app' object", .{});
            };

            if (vm.global.hasException()) {
                @panic("pending exception");
            }

            break :config bake.bakeOptionsFromJs(vm.global, app) catch |err| {
                Output.panic("TODO, print this error better: {}", .{err});
            };
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

    var client_bundler: bun.bundler.Bundler = undefined;
    var server_bundler: bun.bundler.Bundler = undefined;
    var ssr_bundler: bun.bundler.Bundler = undefined;
    try framework.initBundler(allocator, vm.log, .production, .server, &server_bundler);
    try framework.initBundler(allocator, vm.log, .production, .client, &client_bundler);
    if (separate_ssr_graph) {
        try framework.initBundler(allocator, vm.log, .production, .ssr, &ssr_bundler);
    }

    framework.* = framework.resolve(&server_bundler.resolver, &client_bundler.resolver) catch {
        Output.errGeneric("Failed to resolve all imports required by the framework", .{});
        bun.Global.crash();
    };

    Output.prettyErrorln("Bundling routes", .{});
    Output.flush();
    const unique_key = std.crypto.random.int(u64);

    var root_dir_buf: bun.PathBuffer = undefined;
    const root_dir_path = bun.path.joinAbsStringBuf(cwd, &root_dir_buf, &.{"dist"}, .auto);
    const root_path_trailing = root_dir_path.ptr[0 .. root_dir_path.len + 1];
    root_dir_buf[root_dir_path.len] = std.fs.path.sep;
    server_bundler.options.public_path = root_path_trailing;
    server_bundler.resolver.opts.public_path = root_path_trailing;

    var entry_points = std.ArrayList(BakeEntryPoint).init(allocator);
    // the ordering of these entrypoints is relied on when inspecting the output chunks.
    try entry_points.append(BakeEntryPoint.init(framework.entry_server, .server));
    try entry_points.append(BakeEntryPoint.initClientWrapped(framework.entry_client, .client));

    for (options.routes) |route| {
        try entry_points.append(BakeEntryPoint.init(route.entry_point, .server));
    }

    const initial_output = try bun.BundleV2.generateFromBakeProductionCLI(
        entry_points.items,
        &server_bundler,
        .{
            .framework = framework.*,
            .client_bundler = &client_bundler,
            .ssr_bundler = if (separate_ssr_graph) &ssr_bundler else &server_bundler,
        },
        allocator,
        .{ .js = vm.event_loop },
        unique_key,
    );

    Output.prettyErrorln("Rendering routes", .{});
    Output.flush();

    var root_dir = try std.fs.cwd().makeOpenPath("dist", .{});
    defer root_dir.close();

    var chunk_id_client_entry: u32 = std.math.maxInt(u32);

    var module_key_server_entry: JSValue = .undefined;
    const module_key_routes = JSValue.createEmptyArray(vm.global, options.routes.len);

    for (initial_output.items, 0..) |file, i| {
        std.debug.print("{} - {s} : {s} - {?d}\n", .{ file.side, file.src_path.text, file.dest_path, file.entry_point_index });

        switch (file.side) {
            .client => {
                // client-side resources will be written to disk for usage in on the client side
                _ = try file.writeToDisk(root_dir, root_dir_path);

                if (file.entry_point_index) |entry_point| {
                    switch (entry_point) {
                        1 => chunk_id_client_entry = @intCast(i),
                        else => |j| Output.panic("unknown client entry point index {d}", .{j}),
                    }
                }
            },
            .server => {
                _ = try file.writeToDisk(root_dir, root_dir_path);

                switch (file.output_kind) {
                    .@"entry-point", .chunk => {
                        var buf: bun.PathBuffer = undefined;
                        const module_key = BakeRegisterProductionChunk(
                            vm.global,
                            bun.String.createUTF8(bun.path.joinAbsStringBuf(cwd, &buf, &.{
                                root_dir_path,
                                file.dest_path,
                            }, .auto)),
                            file.value.toBunString(),
                        ) catch |err| {
                            vm.printErrorLikeObjectToConsole(vm.global.takeException(err));
                            if (vm.exit_handler.exit_code == 0) {
                                vm.exit_handler.exit_code = 1;
                            }
                            Output.errGeneric("could not load bundled chunk {} for server-side rendering", .{
                                bun.fmt.quote(file.dest_path),
                            });
                            vm.globalExit();
                        };

                        if (file.entry_point_index) |entry_point| {
                            // classify the entry point. since entry point source indices are
                            // deterministic, we can map every single one back to the route or
                            // framework file.
                            switch (entry_point) {
                                0 => module_key_server_entry = module_key,
                                1 => {}, // client entry
                                else => |j| module_key_routes.putIndex(vm.global, j - 2, module_key),
                            }
                        }
                    },
                    else => bun.todoPanic(@src(), "handle server side .{s}", .{@tagName(file.output_kind)}),
                }
            },
        }
    }

    bun.assert(chunk_id_client_entry != std.math.maxInt(u32));
    bun.assert(module_key_server_entry != .undefined);

    // HACK: react-server-dom-webpack assigns to `__webpack_require__.u`
    // We never call this in this context, so we will just make '__webpack_require__' an empty object.
    // Right now server.tsx is what controls the value, but imports happen first.
    vm.global.toJSValue().put(vm.global, "__webpack_require__", JSValue.createEmptyObject(vm.global, 0));

    // Static site generator
    const server_entry_point = loadModule(vm, module_key_server_entry);
    server_entry_point.print(vm.global, .Log, .Info);
    const server_render_func: JSValue = BakeGetOnModuleNamespace(vm.global, server_entry_point, "renderStatic") orelse {
        Output.errGeneric("Framework does not support static site generation", .{});
        Output.note("The file {s} is missing the \"renderStatic\" export", .{bun.fmt.quote(framework.entry_server)});
        bun.Global.crash();
    };
    server_render_func.print(vm.global, .Log, .Info);

    const render_promise = BakeRenderRoutesForProd(
        vm.global,
        bun.String.init(root_dir_path),
        server_render_func,
        module_key_routes,
    );
    vm.waitForPromise(.{ .normal = render_promise });
}

/// unsafe function, must be run outside of the event loop
/// quits the process on exception
fn loadModule(vm: *VirtualMachine, key: JSValue) JSValue {
    const promise = BakeLoadModuleByKey(vm.global, key).asAnyPromise().?.internal;
    vm.waitForPromise(.{ .internal = promise });
    switch (promise.unwrap(vm.jsc, .mark_handled)) {
        .pending => unreachable,
        .fulfilled => |val| {
            bun.assert(val == .undefined);
            return BakeGetModuleNamespace(vm.global, key);
        },
        .rejected => |err| {
            vm.printErrorLikeObjectToConsole(err);
            if (vm.exit_handler.exit_code == 0) {
                vm.exit_handler.exit_code = 1;
            }
            vm.globalExit();
        },
    }
}

const std = @import("std");

const bun = @import("root").bun;
const bake = bun.bake;
const Environment = bun.Environment;
const Output = bun.Output;
const BakeEntryPoint = bun.bundle_v2.BakeEntryPoint;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const VirtualMachine = JSC.VirtualMachine;
