const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");

const lex = bun.js_lexer;
const logger = bun.logger;
const options = @import("options.zig");
const js_parser = bun.js_parser;
const json_parser = bun.JSON;
const js_printer = bun.js_printer;
const js_ast = bun.JSAst;
const linker = @import("linker.zig");

const sync = @import("./sync.zig");
const Api = @import("api/schema.zig").Api;
const resolve_path = @import("./resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("./bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("cli.zig").Command;
const bundler = bun.bundler;
const DotEnv = @import("env_loader.zig");
const which = @import("which.zig").which;
const JSC = bun.JSC;
const AsyncHTTP = bun.http.AsyncHTTP;
const Arena = @import("./mimalloc_arena.zig").Arena;

const OpaqueWrap = JSC.OpaqueWrap;
const VirtualMachine = JSC.VirtualMachine;

var run: Run = undefined;
pub const Run = struct {
    ctx: Command.Context,
    vm: *VirtualMachine,
    entry_path: string,
    arena: Arena,
    any_unhandled: bool = false,

    pub fn bootStandalone(ctx: Command.Context, entry_path: string, graph: bun.StandaloneModuleGraph) !void {
        JSC.markBinding(@src());
        bun.JSC.initialize(false);
        bun.Analytics.Features.standalone_executable += 1;

        const graph_ptr = try bun.default_allocator.create(bun.StandaloneModuleGraph);
        graph_ptr.* = graph;

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
            }),
            .arena = arena,
            .ctx = ctx,
            .entry_path = entry_path,
        };

        var vm = run.vm;
        var b = &vm.bundler;
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

        b.configureRouter(false) catch {
            failWithBuildError(vm);
        };
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
        bun.HTTPThread.init();

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
        @setCold(true);

        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()` function to populate environment variables probably should split out the functionality
        var bundle = try bun.Bundler.init(
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

    pub fn boot(ctx: Command.Context, entry_path: string) !void {
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
                },
            ),
            .arena = arena,
            .ctx = ctx,
            .entry_path = entry_path,
        };

        var vm = run.vm;
        var b = &vm.bundler;
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

        b.configureRouter(false) catch {
            failWithBuildError(vm);
        };
        b.configureDefines() catch {
            failWithBuildError(vm);
        };

        AsyncHTTP.loadEnv(vm.allocator, vm.log, b.env);

        vm.loadExtraEnvAndSourceCodePrinter();
        vm.is_main_thread = true;
        JSC.VirtualMachine.is_main_thread_vm = true;

        // Allow setting a custom timezone
        if (vm.bundler.env.get("TZ")) |tz| {
            if (tz.len > 0) {
                _ = vm.global.setTimeZone(&JSC.ZigString.init(tz));
            }
        }

        vm.bundler.env.loadTracy();

        doPreconnect(ctx.runtime_options.preconnect);

        const callback = OpaqueWrap(Run, Run.start);
        vm.global.vm().holdAPILock(&run, callback);
    }

    fn onUnhandledRejectionBeforeClose(this: *JSC.VirtualMachine, _: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        this.runErrorHandler(value, this.onUnhandledRejectionExceptionList);
        run.any_unhandled = true;
    }

    extern fn Bun__ExposeNodeModuleGlobals(*JSC.JSGlobalObject) void;

    pub fn start(this: *Run) void {
        var vm = this.vm;
        vm.hot_reload = this.ctx.debug.hot_reload;
        vm.onUnhandledRejection = &onUnhandledRejectionBeforeClose;

        if (this.ctx.runtime_options.eval.script.len > 0) {
            Bun__ExposeNodeModuleGlobals(vm.global);
        }

        switch (this.ctx.debug.hot_reload) {
            .hot => JSC.HotReloader.enableHotModuleReloading(vm),
            .watch => JSC.WatchReloader.enableHotModuleReloading(vm),
            else => {},
        }

        if (strings.eqlComptime(this.entry_path, ".") and vm.bundler.fs.top_level_dir.len > 0) {
            this.entry_path = vm.bundler.fs.top_level_dir;
        }

        if (vm.loadEntryPoint(this.entry_path)) |promise| {
            if (promise.status(vm.global.vm()) == .Rejected) {
                const handled = vm.uncaughtException(vm.global, promise.result(vm.global.vm()), true);

                if (vm.hot_reload != .none or handled) {
                    vm.eventLoop().tick();
                    vm.eventLoop().tickPossiblyForever();
                } else {
                    vm.exit_handler.exit_code = 1;
                    vm.onExit();

                    if (run.any_unhandled) {
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

            if (vm.hot_reload != .none) {
                vm.eventLoop().tick();
                vm.eventLoop().tickPossiblyForever();
            } else {
                vm.exit_handler.exit_code = 1;
                vm.onExit();
                if (run.any_unhandled) {
                    bun.JSC.SavedSourceMap.MissingSourceMapNoteInfo.print();

                    Output.prettyErrorln(
                        "<r>\n<d>{s}<r>",
                        .{Global.unhandled_error_bun_version_string},
                    );
                }
                vm.globalExit();
            }
        }

        // don't run the GC if we don't actually need to
        if (vm.isEventLoopAlive() or
            vm.eventLoop().tickConcurrentWithCount() > 0)
        {
            vm.global.vm().releaseWeakRefs();
            _ = vm.arena.gc(false);
            _ = vm.global.vm().runGC(false);
            vm.tick();
        }

        {
            if (this.vm.isWatcherEnabled()) {
                var prev_promise = this.vm.pending_internal_promise;
                if (prev_promise.status(vm.global.vm()) == .Rejected) {
                    _ = vm.unhandledRejection(this.vm.global, this.vm.pending_internal_promise.result(vm.global.vm()), this.vm.pending_internal_promise.asValue());
                }

                while (true) {
                    while (vm.isEventLoopAlive()) {
                        vm.tick();

                        // Report exceptions in hot-reloaded modules
                        if (this.vm.pending_internal_promise.status(vm.global.vm()) == .Rejected and prev_promise != this.vm.pending_internal_promise) {
                            prev_promise = this.vm.pending_internal_promise;
                            _ = vm.unhandledRejection(this.vm.global, this.vm.pending_internal_promise.result(vm.global.vm()), this.vm.pending_internal_promise.asValue());
                            continue;
                        }

                        vm.eventLoop().autoTickActive();
                    }

                    vm.onBeforeExit();

                    if (this.vm.pending_internal_promise.status(vm.global.vm()) == .Rejected and prev_promise != this.vm.pending_internal_promise) {
                        prev_promise = this.vm.pending_internal_promise;
                        _ = vm.unhandledRejection(this.vm.global, this.vm.pending_internal_promise.result(vm.global.vm()), this.vm.pending_internal_promise.asValue());
                    }

                    vm.eventLoop().tickPossiblyForever();
                }

                if (this.vm.pending_internal_promise.status(vm.global.vm()) == .Rejected and prev_promise != this.vm.pending_internal_promise) {
                    prev_promise = this.vm.pending_internal_promise;
                    _ = vm.unhandledRejection(this.vm.global, this.vm.pending_internal_promise.result(vm.global.vm()), this.vm.pending_internal_promise.asValue());
                }
            } else {
                while (vm.isEventLoopAlive()) {
                    vm.tick();
                    vm.eventLoop().autoTickActive();
                }

                if (this.ctx.runtime_options.eval.eval_and_print) {
                    const to_print = brk: {
                        const result = vm.entry_point_result.value.get() orelse .undefined;
                        if (result.asAnyPromise()) |promise| {
                            switch (promise.status(vm.jsc)) {
                                .Pending => {
                                    result._then(vm.global, .undefined, Bun__onResolveEntryPointResult, Bun__onRejectEntryPointResult);

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

        if (this.any_unhandled and this.vm.exit_handler.exit_code == 0) {
            this.vm.exit_handler.exit_code = 1;

            bun.JSC.SavedSourceMap.MissingSourceMapNoteInfo.print();

            Output.prettyErrorln(
                "<r>\n<d>{s}<r>",
                .{Global.unhandled_error_bun_version_string},
            );
        }

        if (!JSC.is_bindgen) JSC.napi.fixDeadCodeElimination();
        vm.globalExit();
    }
};

pub export fn Bun__onResolveEntryPointResult(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) noreturn {
    const arguments = callframe.arguments(1).slice();
    const result = arguments[0];
    result.print(global, .Log, .Log);
    Global.exit(global.bunVM().exit_handler.exit_code);
    return .undefined;
}

pub export fn Bun__onRejectEntryPointResult(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) noreturn {
    const arguments = callframe.arguments(1).slice();
    const result = arguments[0];
    result.print(global, .Log, .Log);
    Global.exit(global.bunVM().exit_handler.exit_code);
    return .undefined;
}

noinline fn dumpBuildError(vm: *JSC.VirtualMachine) void {
    @setCold(true);

    Output.flush();

    const error_writer = Output.errorWriter();
    var buffered_writer = std.io.bufferedWriter(error_writer);
    defer {
        buffered_writer.flush() catch {};
    }

    const writer = buffered_writer.writer();

    switch (Output.enable_ansi_colors_stderr) {
        inline else => |enable_colors| vm.log.printForLogLevelWithEnableAnsiColors(writer, enable_colors) catch {},
    }
}

noinline fn failWithBuildError(vm: *JSC.VirtualMachine) noreturn {
    @setCold(true);
    dumpBuildError(vm);
    Global.exit(1);
}
