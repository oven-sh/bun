const bun = @import("root").bun;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");
const JSC = @import("root").bun.JSC;
const Api = @import("../api/schema.zig").Api;

extern "C" fn Bun__startReplThread(*JSC.JSGlobalObject) void;

pub const ReplCommand = struct {
    pub fn exec(ctx: bun.CLI.Command.Context) !void {
        bun.JSC.initialize();
        startReplThread(ctx);
        const vm = JSC.VirtualMachine.get();
        Bun__startReplThread(vm.global);

        vm.eventLoop().tick();
        while (vm.isEventLoopAlive()) {
            vm.tick();
            vm.eventLoop().autoTickActive();
        }
        vm.onBeforeExit();

        if (vm.log.msgs.items.len > 0) {
            if (Output.enable_ansi_colors) {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            Output.flush();
        }

        vm.onUnhandledRejection = &onUnhandledRejectionBeforeClose;
        vm.global.handleRejectedPromises();
        if (any_unhandled and vm.exit_handler.exit_code == 0) vm.exit_handler.exit_code = 1;
        const exit_code = vm.exit_handler.exit_code;

        vm.onExit();
        if (!JSC.is_bindgen) JSC.napi.fixDeadCodeElimination();
        Global.exit(exit_code);
    }

    var any_unhandled: bool = false;
    fn onUnhandledRejectionBeforeClose(this: *JSC.VirtualMachine, _: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        this.runErrorHandler(value, null);
        any_unhandled = true;
    }

    fn startReplThread(ctx: bun.CLI.Command.Context) void {
        var arena = bun.MimallocArena.init() catch unreachable;
        Output.Source.configureNamedThread("REPL");
        //JSC.markBinding(@src());

        var vm = JSC.VirtualMachine.init(.{
            .allocator = arena.allocator(),
            .args = std.mem.zeroes(Api.TransformOptions),
            .store_fd = false,
        }) catch @panic("Failed to create REPL VM");
        vm.allocator = arena.allocator();
        vm.arena = &arena;

        vm.bundler.configureDefines() catch @panic("Failed to configure defines");
        vm.is_main_thread = true;
        JSC.VirtualMachine.is_main_thread_vm = true;
        vm.hide_bun_stackframes = true;
        vm.argv = ctx.passthrough;
        vm.eventLoop().ensureWaker();
    }
};
