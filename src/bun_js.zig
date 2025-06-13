const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const strings = bun.strings;
const default_allocator = bun.default_allocator;

const std = @import("std");

const logger = bun.logger;
const options = @import("options.zig");
const js_ast = bun.JSAst;

const Command = @import("cli.zig").Command;
const transpiler = bun.transpiler;
const which = @import("which.zig").which;
const JSC = bun.JSC;
const AsyncHTTP = bun.http.AsyncHTTP;
const Arena = @import("./allocators/mimalloc_arena.zig").Arena;
const DNSResolver = @import("bun.js/api/bun/dns_resolver.zig").DNSResolver;

const OpaqueWrap = JSC.OpaqueWrap;
const VirtualMachine = JSC.VirtualMachine;

var run: Run = undefined;
pub const Run = struct {
    ctx: Command.Context,
    vm: *VirtualMachine,
    entry_path: string,
    arena: Arena,
    any_unhandled: bool = false,
    is_html_entrypoint: bool = false,

    pub fn bootStandalone(ctx: Command.Context, entry_path: string, graph: bun.StandaloneModuleGraph) !void {
        JSC.markBinding(@src());
        bun.JSC.initialize(false);
        bun.Analytics.Features.standalone_executable += 1;

        const graph_ptr = try bun.default_allocator.create(bun.StandaloneModuleGraph);
        graph_ptr.* = graph;
        graph_ptr.set();

        js_ast.Expr.Data.Store.create();
        js_ast.Stmt.Data.Store.create();
        var arena = try Arena.init();

        if (!ctx.debug.loaded_bunfig) {
            try bun.CLI.Arguments.loadConfigPath(ctx.allocator, true, "bunfig.toml", ctx, .RunCommand);
        }

        run = .{
            .vm = try VirtualMachine.initWithModuleGraph(.{
                .allocator = arena.allocator(),
                .log = ctx.log,
                .args = ctx.args,
                .graph = graph_ptr,
                .is_main_thread = true,
                .destruct_main_thread_on_exit = bun.getRuntimeFeatureFlag(.BUN_DESTRUCT_VM_ON_EXIT),
            }),
            .arena = arena,
            .ctx = ctx,
            .entry_path = entry_path,
        };

        var vm = run.vm;
        var b = &vm.transpiler;
        vm.preload = ctx.preloads;
        vm.argv = ctx.passthrough;
        vm.arena = &run.arena;
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

        b.options.serve_plugins = ctx.args.serve_plugins;
        b.options.bunfig_path = ctx.args.bunfig_path;

        // b.options.minify_syntax = ctx.bundler_options.minify_syntax;

        switch (ctx.debug.macros) {
            .disable => {
                b.options.no_macros = true;
            },
            .map => |macros| {
                b.options.macro_remap = macros;
            },
            .unspecified => {},
        }

        b.options.env.behavior = .load_all_without_inlining;

        b.configureDefines() catch {
            failWithBuildError(vm);
        };

        AsyncHTTP.loadEnv(vm.allocator, vm.log, b.env);

        vm.loadExtraEnvAndSourceCodePrinter();
        vm.is_main_thread = true;
        JSC.VirtualMachine.is_main_thread_vm = true;

        doPreconnect(ctx.runtime_options.preconnect);

        const callback = OpaqueWrap(Run, Run.start);
        vm.global.vm().holdAPILock(&run, callback);
    }

    fn doPreconnect(preconnect: []const string) void {
        if (preconnect.len == 0) return;
        bun.HTTPThread.init(&.{});

        for (preconnect) |url_str| {
            const url = bun.URL.parse(url_str);

            if (!url.isHTTP() and !url.isHTTPS()) {
                Output.errGeneric("preconnect URL must be HTTP or HTTPS: {}", .{bun.fmt.quote(url_str)});
                Global.exit(1);
            }

            if (url.hostname.len == 0) {
                Output.errGeneric("preconnect URL must have a hostname: {}", .{bun.fmt.quote(url_str)});
                Global.exit(1);
            }

            if (!url.hasValidPort()) {
                Output.errGeneric("preconnect URL must have a valid port: {}", .{bun.fmt.quote(url_str)});
                Global.exit(1);
            }

            AsyncHTTP.preconnect(url, false);
        }
    }

    fn bootBunShell(ctx: Command.Context, entry_path: []const u8) !bun.shell.ExitCode {
        @branchHint(.cold);

        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()` function to populate environment variables probably should split out the functionality
        var bundle = try bun.Transpiler.init(
            ctx.allocator,
            ctx.log,
            try @import("./bun.js/config.zig").configureTransformOptionsForBunVM(ctx.allocator, ctx.args),
            null,
        );
        try bundle.runEnvLoader(false);
        const mini = JSC.MiniEventLoop.initGlobal(bundle.env);
        mini.top_level_dir = ctx.args.absolute_working_dir orelse "";
        return bun.shell.Interpreter.initAndRunFromFile(ctx, mini, entry_path);
    }

    pub fn boot(ctx: Command.Context, entry_path: string, loader: ?bun.options.Loader) !void {
        JSC.markBinding(@src());

        if (!ctx.debug.loaded_bunfig) {
            try bun.CLI.Arguments.loadConfigPath(ctx.allocator, true, "bunfig.toml", ctx, .RunCommand);
        }

        // The shell does not need to initialize JSC.
        // JSC initialization costs 1-3ms. We skip this if we know it's a shell script.
        if (strings.endsWithComptime(entry_path, ".sh")) {
            const exit_code = try bootBunShell(ctx, entry_path);
            Global.exit(exit_code);
            return;
        }

        bun.JSC.initialize(ctx.runtime_options.eval.eval_and_print);

        js_ast.Expr.Data.Store.create();
        js_ast.Stmt.Data.Store.create();
        var arena = try Arena.init();

        run = .{
            .vm = try VirtualMachine.init(
                .{
                    .allocator = arena.allocator(),
                    .log = ctx.log,
                    .args = ctx.args,
                    .store_fd = ctx.debug.hot_reload != .none,
                    .smol = ctx.runtime_options.smol,
                    .eval = ctx.runtime_options.eval.eval_and_print,
                    .debugger = ctx.runtime_options.debugger,
                    .dns_result_order = DNSResolver.Order.fromStringOrDie(ctx.runtime_options.dns_result_order),
                    .is_main_thread = true,
                    .destruct_main_thread_on_exit = bun.getRuntimeFeatureFlag(.BUN_DESTRUCT_VM_ON_EXIT),
                },
            ),
            .arena = arena,
            .ctx = ctx,
            .entry_path = entry_path,
        };

        var vm = run.vm;
        var b = &vm.transpiler;
        vm.preload = ctx.preloads;
        vm.argv = ctx.passthrough;
        vm.arena = &run.arena;
        vm.allocator = arena.allocator();

        if (ctx.runtime_options.eval.script.len > 0) {
            const script_source = try bun.default_allocator.create(logger.Source);
            script_source.* = logger.Source.initPathString(entry_path, ctx.runtime_options.eval.script);
            vm.module_loader.eval_source = script_source;

            if (ctx.runtime_options.eval.eval_and_print) {
                b.options.dead_code_elimination = false;
            }
        }

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
        // b.options.minify_syntax = ctx.bundler_options.minify_syntax;

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
            failWithBuildError(vm);
        };

        AsyncHTTP.loadEnv(vm.allocator, vm.log, b.env);

        vm.loadExtraEnvAndSourceCodePrinter();
        vm.is_main_thread = true;
        JSC.VirtualMachine.is_main_thread_vm = true;

        // Allow setting a custom timezone
        if (vm.transpiler.env.get("TZ")) |tz| {
            if (tz.len > 0) {
                _ = vm.global.setTimeZone(&JSC.ZigString.init(tz));
            }
        }

        vm.transpiler.env.loadTracy();

        doPreconnect(ctx.runtime_options.preconnect);

        vm.main_is_html_entrypoint = (loader orelse vm.transpiler.options.loader(std.fs.path.extension(entry_path))) == .html;

        const callback = OpaqueWrap(Run, Run.start);
        vm.global.vm().holdAPILock(&run, callback);
    }

    fn onUnhandledRejectionBeforeClose(this: *JSC.VirtualMachine, _: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        this.runErrorHandler(value, this.onUnhandledRejectionExceptionList);
        run.any_unhandled = true;
    }

    pub fn start(this: *Run) void {
        var vm = this.vm;
        vm.hot_reload = this.ctx.debug.hot_reload;
        vm.onUnhandledRejection = &onUnhandledRejectionBeforeClose;

        this.addConditionalGlobals();
        do_redis_preconnect: {
            // This must happen within the API lock, which is why it's not in the "doPreconnect" function
            if (this.ctx.runtime_options.redis_preconnect) {
                // Go through the global object's getter because Bun.redis is a
                // PropertyCallback which means we don't have a WriteBarrier we can access
                const global = vm.global;
                const bun_object = vm.global.toJSValue().get(global, "Bun") catch |err| {
                    vm.global.reportActiveExceptionAsUnhandled(err);
                    break :do_redis_preconnect;
                } orelse break :do_redis_preconnect;
                const redis = bun_object.get(global, "redis") catch |err| {
                    vm.global.reportActiveExceptionAsUnhandled(err);
                    break :do_redis_preconnect;
                } orelse break :do_redis_preconnect;
                const client = redis.as(bun.valkey.JSValkeyClient) orelse break :do_redis_preconnect;
                // If connection fails, this will become an unhandled promise rejection, which is fine.
                _ = client.doConnect(vm.global, redis) catch |err| {
                    vm.global.reportActiveExceptionAsUnhandled(err);
                    break :do_redis_preconnect;
                };
            }
        }

        switch (this.ctx.debug.hot_reload) {
            .hot => JSC.hot_reloader.HotReloader.enableHotModuleReloading(vm),
            .watch => JSC.hot_reloader.WatchReloader.enableHotModuleReloading(vm),
            else => {},
        }

        if (strings.eqlComptime(this.entry_path, ".") and vm.transpiler.fs.top_level_dir.len > 0) {
            this.entry_path = vm.transpiler.fs.top_level_dir;
        }

        var printed_sourcemap_warning_and_version = false;

        if (vm.loadEntryPoint(this.entry_path)) |promise| {
            if (promise.status(vm.global.vm()) == .rejected) {
                const handled = vm.uncaughtException(vm.global, promise.result(vm.global.vm()), true);
                promise.setHandled(vm.global.vm());

                if (vm.hot_reload != .none or handled) {
                    vm.eventLoop().tick();
                    vm.eventLoop().tickPossiblyForever();
                } else {
                    vm.exit_handler.exit_code = 1;
                    vm.onExit();

                    if (run.any_unhandled) {
                        printed_sourcemap_warning_and_version = true;
                        bun.JSC.SavedSourceMap.MissingSourceMapNoteInfo.print();

                        Output.prettyErrorln(
                            "<r>\n<d>{s}<r>",
                            .{Global.unhandled_error_bun_version_string},
                        );
                    }
                    vm.globalExit();
                }
            }

            _ = promise.result(vm.global.vm());

            if (vm.log.msgs.items.len > 0) {
                dumpBuildError(vm);
                vm.log.msgs.items.len = 0;
            }
        } else |err| {
            if (vm.log.msgs.items.len > 0) {
                dumpBuildError(vm);
                vm.log.msgs.items.len = 0;
            } else {
                Output.prettyErrorln("Error occurred loading entry point: {s}", .{@errorName(err)});
                Output.flush();
            }
            // TODO: Do a event loop tick when we figure out how to watch the file that wasn't found
            //   under hot reload mode
            vm.exit_handler.exit_code = 1;
            vm.onExit();
            if (run.any_unhandled) {
                printed_sourcemap_warning_and_version = true;
                bun.JSC.SavedSourceMap.MissingSourceMapNoteInfo.print();

                Output.prettyErrorln(
                    "<r>\n<d>{s}<r>",
                    .{Global.unhandled_error_bun_version_string},
                );
            }
            vm.globalExit();
        }

        // don't run the GC if we don't actually need to
        if (vm.isEventLoopAlive() or
            vm.eventLoop().tickConcurrentWithCount() > 0)
        {
            vm.global.vm().releaseWeakRefs();
            _ = vm.arena.gc();
            _ = vm.global.vm().runGC(false);
            vm.tick();
        }

        {
            if (this.vm.isWatcherEnabled()) {
                vm.handlePendingInternalPromiseRejection();

                while (true) {
                    while (vm.isEventLoopAlive()) {
                        vm.tick();

                        // Report exceptions in hot-reloaded modules
                        vm.handlePendingInternalPromiseRejection();

                        vm.eventLoop().autoTickActive();
                    }

                    vm.onBeforeExit();

                    vm.handlePendingInternalPromiseRejection();

                    vm.eventLoop().tickPossiblyForever();
                }
            } else {
                while (vm.isEventLoopAlive()) {
                    vm.tick();
                    vm.eventLoop().autoTickActive();
                }

                if (this.ctx.runtime_options.eval.eval_and_print) {
                    const to_print = brk: {
                        const result: JSC.JSValue = vm.entry_point_result.value.get() orelse .js_undefined;
                        if (result.asAnyPromise()) |promise| {
                            switch (promise.status(vm.jsc)) {
                                .pending => {
                                    result._then2(vm.global, .js_undefined, Bun__onResolveEntryPointResult, Bun__onRejectEntryPointResult);

                                    vm.tick();
                                    vm.eventLoop().autoTickActive();

                                    while (vm.isEventLoopAlive()) {
                                        vm.tick();
                                        vm.eventLoop().autoTickActive();
                                    }

                                    break :brk result;
                                },
                                else => break :brk promise.result(vm.jsc),
                            }
                        }

                        break :brk result;
                    };

                    to_print.print(vm.global, .Log, .Log);
                }

                vm.onBeforeExit();
            }

            if (vm.log.msgs.items.len > 0) {
                dumpBuildError(vm);
                Output.flush();
            }
        }

        vm.onUnhandledRejection = &onUnhandledRejectionBeforeClose;
        vm.global.handleRejectedPromises();
        vm.onExit();

        if (this.any_unhandled and !printed_sourcemap_warning_and_version) {
            this.vm.exit_handler.exit_code = 1;

            bun.JSC.SavedSourceMap.MissingSourceMapNoteInfo.print();

            Output.prettyErrorln(
                "<r>\n<d>{s}<r>",
                .{Global.unhandled_error_bun_version_string},
            );
        }

        bun.api.napi.fixDeadCodeElimination();
        bun.crash_handler.fixDeadCodeElimination();
        vm.globalExit();
    }

    extern fn Bun__ExposeNodeModuleGlobals(*JSC.JSGlobalObject) void;
    /// add `gc()` to `globalThis`.
    extern fn JSC__JSGlobalObject__addGc(*JSC.JSGlobalObject) void;

    fn addConditionalGlobals(this: *Run) void {
        const vm = this.vm;
        const runtime_options: *const Command.RuntimeOptions = &this.ctx.runtime_options;

        if (runtime_options.eval.script.len > 0) {
            Bun__ExposeNodeModuleGlobals(vm.global);
        }
        if (runtime_options.expose_gc) {
            JSC__JSGlobalObject__addGc(vm.global);
        }
    }
};

pub export fn Bun__onResolveEntryPointResult(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) noreturn {
    const arguments = callframe.arguments_old(1).slice();
    const result = arguments[0];
    result.print(global, .Log, .Log);
    Global.exit(global.bunVM().exit_handler.exit_code);
    return .js_undefined;
}

pub export fn Bun__onRejectEntryPointResult(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) noreturn {
    const arguments = callframe.arguments_old(1).slice();
    const result = arguments[0];
    result.print(global, .Log, .Log);
    Global.exit(global.bunVM().exit_handler.exit_code);
    return .js_undefined;
}

noinline fn dumpBuildError(vm: *JSC.VirtualMachine) void {
    @branchHint(.cold);

    Output.flush();

    const error_writer = Output.errorWriter();
    var buffered_writer = std.io.bufferedWriter(error_writer);
    defer {
        buffered_writer.flush() catch {};
    }

    const writer = buffered_writer.writer();

    vm.log.print(writer) catch {};
}

pub noinline fn failWithBuildError(vm: *JSC.VirtualMachine) noreturn {
    @branchHint(.cold);
    dumpBuildError(vm);
    Global.exit(1);
}
