const bun = @import("global.zig");
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

const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const linker = @import("linker.zig");
const panicky = @import("panic_handler.zig");
const sync = @import("./sync.zig");
const Api = @import("api/schema.zig").Api;
const resolve_path = @import("./resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("./bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("cli.zig").Command;
const bundler = @import("bundler.zig");
const NodeModuleBundle = @import("node_module_bundle.zig").NodeModuleBundle;
const DotEnv = @import("env_loader.zig");
const which = @import("which.zig").which;
const VirtualMachine = @import("javascript_core").VirtualMachine;
const JSC = @import("javascript_core");
const AsyncHTTP = @import("http").AsyncHTTP;
const Arena = @import("./mimalloc_arena.zig").Arena;

const OpaqueWrap = JSC.OpaqueWrap;

pub const Run = struct {
    file: std.fs.File,
    ctx: Command.Context,
    vm: *VirtualMachine,
    entry_path: string,
    arena: Arena = undefined,

    pub fn boot(ctx: Command.Context, file: std.fs.File, entry_path: string) !void {
        if (comptime JSC.is_bindgen) unreachable;
        @import("bun.js/javascript_core_c_api.zig").JSCInitialize();

        js_ast.Expr.Data.Store.create(default_allocator);
        js_ast.Stmt.Data.Store.create(default_allocator);
        var arena = try Arena.init();

        var run = Run{
            .vm = try VirtualMachine.init(arena.allocator(), ctx.args, null, ctx.log, null),
            .file = file,
            .arena = arena,
            .ctx = ctx,
            .entry_path = entry_path,
        };
        run.vm.argv = ctx.passthrough;
        run.vm.arena = &run.arena;

        run.vm.bundler.options.install = ctx.install;
        run.vm.bundler.options.enable_auto_install = ctx.debug.auto_install_setting orelse true;
        run.vm.bundler.options.prefer_offline_install = (ctx.debug.offline_mode_setting orelse bun.Bunfig.OfflineMode.online) == .offline;

        run.vm.bundler.options.install = ctx.install;
        run.vm.bundler.resolver.opts.enable_auto_install = run.vm.bundler.options.enable_auto_install;

        run.vm.bundler.resolver.opts.prefer_offline_install = run.vm.bundler.options.prefer_offline_install;
        run.vm.bundler.main_file_for_package_manager = entry_path;

        if (ctx.debug.macros) |macros| {
            run.vm.bundler.options.macro_remap = macros;
        }

        run.vm.bundler.configureRouter(false) catch {
            if (Output.enable_ansi_colors_stderr) {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Global.exit(1);
        };
        run.vm.bundler.configureDefines() catch {
            if (Output.enable_ansi_colors_stderr) {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Global.exit(1);
        };
        AsyncHTTP.max_simultaneous_requests = 255;

        if (run.vm.bundler.env.map.get("BUN_CONFIG_MAX_HTTP_REQUESTS")) |max_http_requests| {
            load: {
                AsyncHTTP.max_simultaneous_requests = std.fmt.parseInt(u16, max_http_requests, 10) catch {
                    run.vm.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        run.vm.allocator,
                        "BUN_CONFIG_MAX_HTTP_REQUESTS value \"{s}\" is not a valid integer between 1 and 65535",
                        .{max_http_requests},
                    ) catch unreachable;
                    break :load;
                };

                if (AsyncHTTP.max_simultaneous_requests == 0) {
                    run.vm.log.addWarningFmt(
                        null,
                        logger.Loc.Empty,
                        run.vm.allocator,
                        "BUN_CONFIG_MAX_HTTP_REQUESTS value must be a number between 1 and 65535",
                        .{},
                    ) catch unreachable;
                    AsyncHTTP.max_simultaneous_requests = 255;
                }
            }
        }

        if (run.vm.bundler.env.map.get("BUN_OVERRIDE_MODULE_PATH")) |override_path| {
            if (override_path.len > 0) {
                run.vm.load_builtins_from_path = override_path;
            }
        }

        run.vm.is_main_thread = true;
        JSC.VirtualMachine.is_main_thread_vm = true;

        var callback = OpaqueWrap(Run, Run.start);
        run.vm.global.vm().holdAPILock(&run, callback);
    }

    pub fn start(this: *Run) void {
        if (this.ctx.debug.hot_reload) {
            JSC.HotReloader.enableHotModuleReloading(this.vm);
        }
        var promise = this.vm.loadEntryPoint(this.entry_path) catch return;

        if (promise.status(this.vm.global.vm()) == .Rejected) {
            this.vm.runErrorHandler(promise.result(this.vm.global.vm()), null);
            Global.exit(1);
        }

        _ = promise.result(this.vm.global.vm());

        if (this.vm.log.msgs.items.len > 0) {
            if (Output.enable_ansi_colors) {
                this.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                this.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Output.flush();
        }

        // don't run the GC if we don't actually need to
        if (this.vm.eventLoop().tasks.count > 0 or this.vm.active_tasks > 0 or
            this.vm.uws_event_loop.?.active > 0 or
            this.vm.eventLoop().tickConcurrentWithCount() > 0)
        {
            this.vm.global.vm().releaseWeakRefs();
            _ = this.vm.arena.gc(false);
            _ = this.vm.global.vm().runGC(false);
            this.vm.tick();
        }

        {
            while (this.vm.eventLoop().tasks.count > 0 or this.vm.active_tasks > 0 or this.vm.uws_event_loop.?.active > 0) {
                this.vm.tick();
                this.vm.eventLoop().autoTick();
            }

            if (this.vm.log.msgs.items.len > 0) {
                if (Output.enable_ansi_colors) {
                    this.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                } else {
                    this.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                }
                Output.prettyErrorln("\n", .{});
                Output.flush();
            }
        }

        this.vm.onExit();

        if (!JSC.is_bindgen) JSC.napi.fixDeadCodeElimination();

        Global.exit(0);
    }
};
