const _global = @import("global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
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
const configureTransformOptionsForBun = @import("./javascript/jsc/config.zig").configureTransformOptionsForBun;
const Command = @import("cli.zig").Command;
const bundler = @import("bundler.zig");
const NodeModuleBundle = @import("node_module_bundle.zig").NodeModuleBundle;
const DotEnv = @import("env_loader.zig");
const which = @import("which.zig").which;
const VirtualMachine = @import("javascript_core").VirtualMachine;
const JSC = @import("javascript_core");

const OpaqueWrap = JSC.OpaqueWrap;

pub const Run = struct {
    file: std.fs.File,
    ctx: Command.Context,
    vm: *VirtualMachine,
    entry_path: string,

    pub fn boot(ctx: Command.Context, file: std.fs.File, entry_path: string) !void {
        @import("javascript/jsc/javascript_core_c_api.zig").JSCInitialize();

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
            Output.flush();
            Global.exit(1);
        };
        run.vm.bundler.configureDefines() catch {
            if (Output.enable_ansi_colors_stderr) {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Output.flush();
            Global.exit(1);
        };

        var callback = OpaqueWrap(Run, Run.start);
        run.vm.global.vm().holdAPILock(&run, callback);
    }

    pub fn start(this: *Run) void {
        var promise = this.vm.loadEntryPoint(this.entry_path) catch return;
        this.vm.tick();

        while (promise.status(this.vm.global.vm()) == .Pending) {
            this.vm.tick();
        }

        if (promise.status(this.vm.global.vm()) == .Rejected) {
            this.vm.defaultErrorHandler(promise.result(this.vm.global.vm()), null);
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
        }

        Output.flush();

        Global.exit(0);
    }
};
