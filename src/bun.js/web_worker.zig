const bun = @import("root").bun;
const JSC = bun.JSC;
const Output = bun.Output;
const log = Output.scoped(.Worker);
const std = @import("std");
pub const WebWorker = struct {
    // null when haven't started yet
    vm: ?*JSC.VirtualMachine = null,
    status: Status = .start,
    requested_terminate: bool = false,
    execution_context_id: u32 = 0,
    parent_context_id: u32 = 0,

    /// Already resolved.
    specifier: []const u8 = "",
    api_transform_options: bun.Schema.Api.TransformOptions,
    env_loader: ?*bun.DotEnv.Loader = null,
    store_fd: bool = false,
    arena: bun.MimallocArena = undefined,

    pub fn start(
        this: *WebWorker,
    ) !void {
        std.debug.assert(this.status == .start);
        std.debug.assert(this.vm == null);
        this.arena = try bun.MimallocArena.init();
        var vm = try JSC.VirtualMachine.init(this.arena.allocator(), this.api_transform_options, null, null, this.env_loader, this.store_fd);
        this.vm = vm;

        var b = &this.vm.bundler;

        b.configureRouter(false) catch {
            if (Output.enable_ansi_colors_stderr) {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            this.exit();
            return;
        };
        b.configureDefines() catch {
            if (Output.enable_ansi_colors_stderr) {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                vm.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("\n", .{});
            this.exit();
            return;
        };

        vm.loadExtraEnv();
        vm.is_main_thread = false;
        JSC.VirtualMachine.is_main_thread_vm = false;
        var callback = JSC.OpaqueWrap(WebWorker, WebWorker.spin);
        vm.global.vm().holdAPILock(&this, callback);
    }

    fn spin(this: *WebWorker) void {
        var vm = this.vm.?;
        _ = vm;
        std.debug.assert(this.status == .start);
        this.status = .running;

        this.status = .terminated;
        this.onTerminate();
    }

    pub const Status = enum {
        start,
        running,
        terminated,
    };

    pub fn terminate(this: *WebWorker) void {
        if (this.requested_terminate == false) {
            return;
        }

        this.requestTerminate();
    }

    fn onTerminate(this: *WebWorker) void {
        _ = this;
        log("onTerminate", .{});
    }

    fn requestTerminate(this: *WebWorker) bool {
        var vm = this.vm orelse {
            this.requested_terminate = true;
            return false;
        };
        log("requesting terminate", .{});
        var concurrent_task = bun.default_allocator.create(JSC.ConcurrentTask) catch @panic("OOM");
        var task = bun.default_allocator.create(JSC.AnyTask) catch @panic("OOM");
        task.* = JSC.AnyTask.New(*WebWorker, this).init(this);
        vm.eventLoop().enqueueTaskConcurrent(concurrent_task.from(task));
        return true;
    }
};
