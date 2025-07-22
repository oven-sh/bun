const JSCScheduler = @This();

pub const JSCDeferredWorkTask = opaque {
    extern fn Bun__runDeferredWork(task: *JSCScheduler.JSCDeferredWorkTask) void;
    pub fn run(task: *JSCScheduler.JSCDeferredWorkTask) void {
        const globalThis = bun.jsc.VirtualMachine.get().global;
        var scope: bun.jsc.ExceptionValidationScope = undefined;
        scope.init(globalThis, @src());
        defer scope.deinit();
        Bun__runDeferredWork(task);
        scope.assertNoExceptionExceptTermination() catch return; // TODO: properly propagate exception upwards
    }
};

export fn Bun__eventLoop__incrementRefConcurrently(jsc_vm: *VirtualMachine, delta: c_int) void {
    JSC.markBinding(@src());

    if (delta > 0) {
        jsc_vm.event_loop.refConcurrently();
    } else {
        jsc_vm.event_loop.unrefConcurrently();
    }
}

export fn Bun__queueJSCDeferredWorkTaskConcurrently(jsc_vm: *VirtualMachine, task: *JSCScheduler.JSCDeferredWorkTask) void {
    JSC.markBinding(@src());
    var loop = jsc_vm.eventLoop();
    loop.enqueueTaskConcurrent(ConcurrentTask.new(.{
        .task = Task.init(task),
        .next = null,
        .auto_delete = true,
    }));
}

export fn Bun__tickWhilePaused(paused: *bool) void {
    JSC.markBinding(@src());
    VirtualMachine.get().eventLoop().tickWhilePaused(paused);
}

comptime {
    _ = Bun__eventLoop__incrementRefConcurrently;
    _ = Bun__queueJSCDeferredWorkTaskConcurrently;
    _ = Bun__tickWhilePaused;
}

const bun = @import("bun");

const JSC = bun.JSC;
const ConcurrentTask = JSC.ConcurrentTask;
const Task = JSC.Task;
const VirtualMachine = JSC.VirtualMachine;
