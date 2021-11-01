usingnamespace @import("global.zig");
const std = @import("std");

const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const alloc = @import("alloc.zig");
const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const linker = @import("linker.zig");
usingnamespace @import("ast/base.zig");
usingnamespace @import("defines.zig");
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
const VirtualMachine = @import("./javascript/jsc/javascript.zig").VirtualMachine;

pub const Run = struct {
    file: std.fs.File,
    ctx: Command.Context,
    vm: *VirtualMachine,
    entry_path: string,
    pub fn boot(ctx: Command.Context, file: std.fs.File, entry_path: string) !void {
        @import("javascript/jsc/JavascriptCore.zig").JSCInitialize();

        js_ast.Expr.Data.Store.create(default_allocator);
        js_ast.Stmt.Data.Store.create(default_allocator);

        var run = Run{
            .vm = try VirtualMachine.init(ctx.allocator, ctx.args, null, ctx.log, null),
            .file = file,
            .ctx = ctx,
            .entry_path = entry_path,
        };

        run.vm.bundler.configureRouter(false) catch |err| {
            if (Output.enable_ansi_colors) {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Output.flush();
            std.os.exit(1);
        };
        run.vm.bundler.configureDefines() catch |err| {
            if (Output.enable_ansi_colors) {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                run.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Output.flush();
            std.os.exit(1);
        };

        try run.start();
    }

    pub fn start(this: *Run) !void {
        var promise = try this.vm.loadEntryPoint(this.entry_path);

        this.vm.global.vm().drainMicrotasks();

        while (promise.status(this.vm.global.vm()) == .Pending) {
            this.vm.global.vm().drainMicrotasks();
        }

        if (promise.status(this.vm.global.vm()) == .Rejected) {
            this.vm.defaultErrorHandler(promise.result(this.vm.global.vm()), null);
            std.os.exit(1);
        }

        _ = promise.result(this.vm.global.vm());

        if (this.vm.log.msgs.items.len > 0) {
            if (Output.enable_ansi_colors) {
                this.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                this.vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
        }

        Output.flush();

        std.os.exit(0);
    }
};
