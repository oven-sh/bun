const bun = @import("root").bun;
const JSC = bun.JSC;
const Output = bun.Output;
const log = Output.scoped(.Worker);
pub const WebWorker = struct {
    // null when haven't started yet
    vm: ?*JSC.VirtualMachine = null,
    status: Status = .start,
    requested_terminate: bool = false,

    pub fn start(resolved_url: bun.String) void {
        _ = resolved_url;
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
