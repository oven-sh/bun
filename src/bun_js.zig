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
const logger = @import("root").bun.logger;
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
const JSC = @import("root").bun.JSC;
const AsyncHTTP = @import("root").bun.http.AsyncHTTP;
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

    pub fn bootStandalone(ctx_: Command.Context, entry_path: string, graph: bun.StandaloneModuleGraph) !void {
        var ctx = ctx_;
        JSC.markBinding(@src());
        bun.JSC.initialize();

        const graph_ptr = try bun.default_allocator.create(bun.StandaloneModuleGraph);
        graph_ptr.* = graph;

        js_ast.Expr.Data.Store.create(default_allocator);
        js_ast.Stmt.Data.Store.create(default_allocator);
        var arena = try Arena.init();

        if (!ctx.debug.loaded_bunfig) {
            try bun.CLI.Arguments.loadConfigPath(ctx.allocator, true, "bunfig.toml", &ctx, .RunCommand);
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
            if (Output.enable_ansi_colors_stderr) {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Global.exit(1);
        };
        b.configureDefines() catch {
            if (Output.enable_ansi_colors_stderr) {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Global.exit(1);
        };

        AsyncHTTP.loadEnv(vm.allocator, vm.log, b.env);

        vm.loadExtraEnv();
        vm.is_main_thread = true;
        JSC.VirtualMachine.is_main_thread_vm = true;

        const callback = OpaqueWrap(Run, Run.start);
        vm.global.vm().holdAPILock(&run, callback);
    }

    fn bootBunShell(ctx: *const Command.Context, entry_path: []const u8) !void {
        @setCold(true);

        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()` function to populate environment variables probably should split out the functionality
        var bundle = try bun.Bundler.init(
            ctx.allocator,
            ctx.log,
            try @import("./bun.js/config.zig").configureTransformOptionsForBunVM(ctx.allocator, ctx.args),
            null,
        );
        try bundle.runEnvLoader();
        const mini = JSC.MiniEventLoop.initGlobal(bundle.env);
        mini.top_level_dir = ctx.args.absolute_working_dir orelse "";
        try bun.shell.InterpreterMini.initAndRunFromFile(mini, entry_path);
        return;
    }

    pub fn boot(ctx_: Command.Context, entry_path: string) !void {
        var ctx = ctx_;
        JSC.markBinding(@src());
        bun.JSC.initialize();

        if (strings.endsWithComptime(entry_path, ".bun.sh")) {
            try bootBunShell(&ctx, entry_path);
            Global.exit(0);
            return;
        }

        js_ast.Expr.Data.Store.create(default_allocator);
        js_ast.Stmt.Data.Store.create(default_allocator);
        var arena = try Arena.init();

        if (!ctx.debug.loaded_bunfig) {
            try bun.CLI.Arguments.loadConfigPath(ctx.allocator, true, "bunfig.toml", &ctx, .RunCommand);
        }

        run = .{
            .vm = try VirtualMachine.init(
                .{
                    .allocator = arena.allocator(),
                    .log = ctx.log,
                    .args = ctx.args,
                    .store_fd = ctx.debug.hot_reload != .none,
                    .smol = ctx.runtime_options.smol,
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

        if (ctx.runtime_options.eval_script.len > 0) {
            vm.module_loader.eval_script = ptr: {
                const v = try bun.default_allocator.create(logger.Source);
                v.* = logger.Source.initPathString(entry_path, ctx.runtime_options.eval_script);
                break :ptr v;
            };
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

        // Set NODE_ENV to a value if something else hadn't already set it
        const node_env_entry = try b.env.map.getOrPutWithoutValue("NODE_ENV");
        if (!node_env_entry.found_existing) {
            node_env_entry.key_ptr.* = try b.env.allocator.dupe(u8, node_env_entry.key_ptr.*);
            node_env_entry.value_ptr.* = .{
                .value = try b.env.allocator.dupe(u8, "development"),
                .conditional = false,
            };
        }

        b.configureRouter(false) catch {
            if (Output.enable_ansi_colors_stderr) {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Global.exit(1);
        };
        b.configureDefines() catch {
            if (Output.enable_ansi_colors_stderr) {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Global.exit(1);
        };

        AsyncHTTP.loadEnv(vm.allocator, vm.log, b.env);

        vm.loadExtraEnv();
        vm.is_main_thread = true;
        JSC.VirtualMachine.is_main_thread_vm = true;

        // Allow setting a custom timezone
        if (vm.bundler.env.get("TZ")) |tz| {
            if (tz.len > 0) {
                _ = vm.global.setTimeZone(&JSC.ZigString.init(tz));
            }
        }

        vm.bundler.env.loadTracy();

        const callback = OpaqueWrap(Run, Run.start);
        vm.global.vm().holdAPILock(&run, callback);
    }

    fn onUnhandledRejectionBeforeClose(this: *JSC.VirtualMachine, _: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        this.runErrorHandler(value, null);
        run.any_unhandled = true;
    }

    extern fn Bun__ExposeNodeModuleGlobals(*JSC.JSGlobalObject) void;

    pub fn start(this: *Run) void {
        var vm = this.vm;
        vm.hot_reload = this.ctx.debug.hot_reload;
        vm.onUnhandledRejection = &onUnhandledRejectionBeforeClose;

        if (this.ctx.runtime_options.eval_script.len > 0) {
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
                vm.runErrorHandler(promise.result(vm.global.vm()), null);

                if (vm.hot_reload != .none) {
                    vm.eventLoop().tick();
                    vm.eventLoop().tickPossiblyForever();
                } else {
                    vm.exit_handler.exit_code = 1;
                    vm.onExit();
                    Global.exit(1);
                }
            }

            _ = promise.result(vm.global.vm());

            if (vm.log.msgs.items.len > 0) {
                if (Output.enable_ansi_colors) {
                    vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                } else {
                    vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                }
                vm.log.msgs.items.len = 0;
                Output.prettyErrorln("\n", .{});
                Output.flush();
            }
        } else |err| {
            if (vm.log.msgs.items.len > 0) {
                if (Output.enable_ansi_colors) {
                    vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                } else {
                    vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                }
                Output.flush();
            } else {
                Output.prettyErrorln("Error occurred loading entry point: {s}", .{@errorName(err)});
            }

            if (vm.hot_reload != .none) {
                vm.eventLoop().tick();
                vm.eventLoop().tickPossiblyForever();
            } else {
                vm.exit_handler.exit_code = 1;
                vm.onExit();
                Global.exit(1);
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
                    vm.onUnhandledError(this.vm.global, this.vm.pending_internal_promise.result(vm.global.vm()));
                }

                while (true) {
                    while (vm.isEventLoopAlive()) {
                        vm.tick();

                        // Report exceptions in hot-reloaded modules
                        if (this.vm.pending_internal_promise.status(vm.global.vm()) == .Rejected and prev_promise != this.vm.pending_internal_promise) {
                            prev_promise = this.vm.pending_internal_promise;
                            vm.onUnhandledError(this.vm.global, this.vm.pending_internal_promise.result(vm.global.vm()));
                            continue;
                        }

                        vm.eventLoop().autoTickActive();
                    }

                    vm.onBeforeExit();

                    if (this.vm.pending_internal_promise.status(vm.global.vm()) == .Rejected and prev_promise != this.vm.pending_internal_promise) {
                        prev_promise = this.vm.pending_internal_promise;
                        vm.onUnhandledError(this.vm.global, this.vm.pending_internal_promise.result(vm.global.vm()));
                    }

                    vm.eventLoop().tickPossiblyForever();
                }

                if (this.vm.pending_internal_promise.status(vm.global.vm()) == .Rejected and prev_promise != this.vm.pending_internal_promise) {
                    prev_promise = this.vm.pending_internal_promise;
                    vm.onUnhandledError(this.vm.global, this.vm.pending_internal_promise.result(vm.global.vm()));
                }
            } else {
                //
                while (vm.isEventLoopAlive()) {
                    vm.tick();
                    vm.eventLoop().autoTickActive();
                }

                vm.onBeforeExit();
            }

            if (vm.log.msgs.items.len > 0) {
                if (Output.enable_ansi_colors) {
                    vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                } else {
                    vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                }
                Output.prettyErrorln("\n", .{});
                Output.flush();
            }
        }

        vm.onUnhandledRejection = &onUnhandledRejectionBeforeClose;
        vm.global.handleRejectedPromises();
        if (this.any_unhandled and this.vm.exit_handler.exit_code == 0) {
            this.vm.exit_handler.exit_code = 1;
        }
        const exit_code = this.vm.exit_handler.exit_code;

        vm.onExit();

        if (!JSC.is_bindgen) JSC.napi.fixDeadCodeElimination();
        Global.exit(exit_code);
    }
};
