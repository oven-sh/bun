const JSCScheduler = @This();

pub const JSCDeferredWorkTask = opaque {
    extern fn Bun__runDeferredWork(task: *JSCScheduler.JSCDeferredWorkTask) void;
    pub const run = Bun__runDeferredWork;
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
const VirtualMachine = JSC.VirtualMachine;
const Task = JSC.Task;
const ConcurrentTask = JSC.ConcurrentTask;
