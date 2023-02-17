const bun = @import("bun");
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
const logger = @import("bun").logger;
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
const NodeModuleBundle = @import("node_module_bundle.zig").NodeModuleBundle;
const DotEnv = @import("env_loader.zig");
const which = @import("which.zig").which;
const JSC = @import("bun").JSC;
const AsyncHTTP = @import("bun").HTTP.AsyncHTTP;
const Arena = @import("./mimalloc_arena.zig").Arena;

const OpaqueWrap = JSC.OpaqueWrap;
const VirtualMachine = JSC.VirtualMachine;

var run: Run = undefined;
pub const Run = struct {
    file: std.fs.File,
    ctx: Command.Context,
    vm: *VirtualMachine,
    entry_path: string,
    arena: Arena = undefined,
    any_unhandled: bool = false,

    pub fn boot(ctx: Command.Context, file: std.fs.File, entry_path: string) !void {
        JSC.markBinding(@src());
        @import("bun.js/javascript_core_c_api.zig").JSCInitialize();

        js_ast.Expr.Data.Store.create(default_allocator);
        js_ast.Stmt.Data.Store.create(default_allocator);
        var arena = try Arena.init();

        run = .{
            .vm = try VirtualMachine.init(arena.allocator(), ctx.args, null, ctx.log, null),
            .file = file,
            .arena = arena,
            .ctx = ctx,
            .entry_path = entry_path,
        };
        var vm = run.vm;
        var b = &vm.bundler;

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

        if (ctx.debug.macros) |macros| {
            b.options.macro_remap = macros;
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
        AsyncHTTP.max_simultaneous_requests = 255;

        if (b.env.map.get("BUN_CONFIG_MAX_HTTP_REQUESTS")) |max_http_requests| {
            load: {
                AsyncHTTP.max_simultaneous_requests = std.fmt.parseInt(u16, max_http_requests, 10) catch {
                    vm.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        vm.allocator,
                        "BUN_CONFIG_MAX_HTTP_REQUESTS value \"{s}\" is not a valid integer between 1 and 65535",
                        .{max_http_requests},
                    ) catch unreachable;
                    break :load;
                };

                if (AsyncHTTP.max_simultaneous_requests == 0) {
                    vm.log.addWarningFmt(
                        null,
                        logger.Loc.Empty,
                        vm.allocator,
                        "BUN_CONFIG_MAX_HTTP_REQUESTS value must be a number between 1 and 65535",
                        .{},
                    ) catch unreachable;
                    AsyncHTTP.max_simultaneous_requests = 255;
                }
            }
        }

        vm.loadExtraEnv();
        vm.is_main_thread = true;
        JSC.VirtualMachine.is_main_thread_vm = true;

        var callback = OpaqueWrap(Run, Run.start);
        vm.global.vm().holdAPILock(&run, callback);
    }

    fn onUnhandledRejectionBeforeClose(this: *JSC.VirtualMachine, _: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        this.runErrorHandler(value, null);
        run.any_unhandled = true;
    }

    pub fn start(this: *Run) void {
        var vm = this.vm;
        if (this.ctx.debug.hot_reload) {
            JSC.HotReloader.enableHotModuleReloading(vm);
        }
        var promise = vm.loadEntryPoint(this.entry_path) catch return;

        if (promise.status(vm.global.vm()) == .Rejected) {
            vm.runErrorHandler(promise.result(vm.global.vm()), null);
            Global.exit(1);
        }

        _ = promise.result(vm.global.vm());

        if (vm.log.msgs.items.len > 0) {
            if (Output.enable_ansi_colors) {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Output.flush();
        }

        // don't run the GC if we don't actually need to
        if (vm.eventLoop().tasks.count > 0 or vm.active_tasks > 0 or
            vm.uws_event_loop.?.active > 0 or
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

                while (vm.eventLoop().tasks.count > 0 or vm.active_tasks > 0 or vm.uws_event_loop.?.active > 0) {
                    vm.tick();

                    // Report exceptions in hot-reloaded modules
                    if (this.vm.pending_internal_promise.status(vm.global.vm()) == .Rejected and prev_promise != this.vm.pending_internal_promise) {
                        prev_promise = this.vm.pending_internal_promise;
                        vm.onUnhandledError(this.vm.global, this.vm.pending_internal_promise.result(vm.global.vm()));
                        continue;
                    }

                    vm.eventLoop().autoTickActive();
                }

                if (this.vm.pending_internal_promise.status(vm.global.vm()) == .Rejected and prev_promise != this.vm.pending_internal_promise) {
                    prev_promise = this.vm.pending_internal_promise;
                    vm.onUnhandledError(this.vm.global, this.vm.pending_internal_promise.result(vm.global.vm()));
                }
            } else {
                while (vm.eventLoop().tasks.count > 0 or vm.active_tasks > 0 or vm.uws_event_loop.?.active > 0) {
                    vm.tick();
                    vm.eventLoop().autoTickActive();
                }
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

        vm.onExit();

        if (!JSC.is_bindgen) JSC.napi.fixDeadCodeElimination();
        Global.exit(@boolToInt(this.any_unhandled));
    }
};
