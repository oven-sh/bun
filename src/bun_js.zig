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

const OpaqueWrap = JSC.OpaqueWrap;

pub const Run = struct {
    file: std.fs.File,
    ctx: Command.Context,
    vm: *VirtualMachine,
    entry_path: string,

    pub fn boot(ctx: Command.Context, file: std.fs.File, entry_path: string) !void {
        if (comptime JSC.is_bindgen) unreachable;
        @import("bun.js/javascript_core_c_api.zig").JSCInitialize();

        js_ast.Expr.Data.Store.create(default_allocator);
        js_ast.Stmt.Data.Store.create(default_allocator);

        var run = Run{
            .vm = try VirtualMachine.init(ctx.allocator, ctx.args, null, ctx.log, null),
            .file = file,
            .ctx = ctx,
            .entry_path = entry_path,
        };

        run.vm.argv = ctx.positionals;

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
            Global.crash();
        };
        run.vm.bundler.configureDefines() catch {
            if (Output.enable_ansi_colors_stderr) {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Global.crash();
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

        var callback = OpaqueWrap(Run, Run.start);
        run.vm.global.vm().holdAPILock(&run, callback);
    }

    pub fn start(this: *Run) void {
        var promise = this.vm.loadEntryPoint(this.entry_path) catch return;

        if (promise.status(this.vm.global.vm()) == .Rejected) {
            this.vm.runErrorHandler(promise.result(this.vm.global.vm()), null);
            Global.crash();
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

        this.vm.global.vm().releaseWeakRefs();
        _ = this.vm.global.vm().runGC(false);
        this.vm.tick();

        {
            var i: usize = 0;
            while (this.vm.*.event_loop.pending_tasks_count.loadUnchecked() > 0 or this.vm.active_tasks > 0) {
                this.vm.tick();
                i +%= 1;

                if (i > 0 and i % 100 == 0) {
                    std.time.sleep(std.time.ns_per_us);
                }
            }

            if (i > 0) {
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
        }

        this.vm.onExit();

        if (!JSC.is_bindgen) JSC.napi.fixDeadCodeElimination();

        Global.exit(0);
    }
};
