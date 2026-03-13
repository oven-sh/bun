const JSCScheduler = @This();

pub const JSCDeferredWorkTask = opaque {
    extern fn Bun__runDeferredWork(task: *JSCScheduler.JSCDeferredWorkTask) void;
    pub fn run(task: *JSCScheduler.JSCDeferredWorkTask) bun.JSTerminated!void {
        const globalThis = bun.jsc.VirtualMachine.get().global;
        var scope: bun.jsc.ExceptionValidationScope = undefined;
        scope.init(globalThis, @src());
        defer scope.deinit();
        Bun__runDeferredWork(task);
        try scope.assertNoExceptionExceptTermination();
    }
};

export fn Bun__eventLoop__incrementRefConcurrently(jsc_vm: *VirtualMachine, delta: c_int) void {
    jsc.markBinding(@src());

    if (delta > 0) {
        jsc_vm.event_loop.refConcurrently();
    } else {
        jsc_vm.event_loop.unrefConcurrently();
    }
}

export fn Bun__queueJSCDeferredWorkTaskConcurrently(jsc_vm: *VirtualMachine, task: *JSCScheduler.JSCDeferredWorkTask) void {
    jsc.markBinding(@src());
    var loop = jsc_vm.eventLoop();
    loop.enqueueTaskConcurrent(ConcurrentTask.new(.{
        .task = Task.init(task),
        .next = .auto_delete,
    }));
}

export fn Bun__tickWhilePaused(paused: *bool) void {
    jsc.markBinding(@src());
    VirtualMachine.get().eventLoop().tickWhilePaused(paused);
}

comptime {
    _ = Bun__eventLoop__incrementRefConcurrently;
    _ = Bun__queueJSCDeferredWorkTaskConcurrently;
    _ = Bun__tickWhilePaused;
}

const bun = @import("bun");

const jsc = bun.jsc;
const ConcurrentTask = jsc.ConcurrentTask;
const Task = jsc.Task;
const VirtualMachine = jsc.VirtualMachine;
