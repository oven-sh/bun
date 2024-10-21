//! Implements building to production

// TODO: Dedupe
extern fn BakeGetDefaultExportFromModule(global: *JSC.JSGlobalObject, module: JSValue) JSValue;

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
    // TODO: combine this code with bun_js.zig `pub fn boot`
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
    Output.prettyErrorln("Loading configuration\n", .{});
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

    Output.prettyErrorln("Bundling routes\n", .{});
    const unique_key = std.crypto.random.int(u64);

    var entry_points = std.ArrayList(BakeEntryPoint).init(allocator);
    try entry_points.append(BakeEntryPoint.initClientWrapped(framework.entry_client, .client));
    try entry_points.append(BakeEntryPoint.init(framework.entry_server, .server));

    for (options.routes) |route| {
        try entry_points.append(BakeEntryPoint.init(route.entry_point, .server));
    }

    server_bundler.options.output_dir = "dist";
    server_bundler.resolver.opts.output_dir = "dist";
    server_bundler.options.write = true;

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

    _ = initial_output; // autofix
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
