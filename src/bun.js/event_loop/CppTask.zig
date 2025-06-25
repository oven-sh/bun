/// A task created from C++ code, usually via ScriptExecutionContext.
pub const CppTask = opaque {
    extern fn Bun__performTask(globalObject: *JSC.JSGlobalObject, task: *CppTask) void;
    pub fn run(this: *CppTask, global: *JSC.JSGlobalObject) void {
        JSC.markBinding(@src());
        Bun__performTask(global, this);
    }
};

/// A task created from C++ code that runs inside the workpool, usually via ScriptExecutionContext.
pub const ConcurrentCppTask = struct {
    pub const new = bun.TrivialNew(@This());

    cpp_task: *EventLoopTaskNoContext,
    workpool_task: JSC.WorkPoolTask = .{ .callback = &runFromWorkpool },

    const EventLoopTaskNoContext = opaque {
        extern fn Bun__EventLoopTaskNoContext__performTask(task: *EventLoopTaskNoContext) void;
        extern fn Bun__EventLoopTaskNoContext__createdInBunVm(task: *const EventLoopTaskNoContext) ?*VirtualMachine;

        /// Deallocates `this`
        pub fn run(this: *EventLoopTaskNoContext) void {
            Bun__EventLoopTaskNoContext__performTask(this);
        }

        /// Get the VM that created this task
        pub fn getVM(this: *const EventLoopTaskNoContext) ?*VirtualMachine {
            return Bun__EventLoopTaskNoContext__createdInBunVm(this);
        }
    };

    pub fn runFromWorkpool(task: *JSC.WorkPoolTask) void {
        const this: *ConcurrentCppTask = @fieldParentPtr("workpool_task", task);
        // Extract all the info we need from `this` and `cpp_task` before we call functions that
        // free them
        const cpp_task = this.cpp_task;
        const maybe_vm = cpp_task.getVM();
        bun.destroy(this);
        cpp_task.run();
        if (maybe_vm) |vm| {
            vm.event_loop.unrefConcurrently();
        }
    }

    pub export fn ConcurrentCppTask__createAndRun(cpp_task: *EventLoopTaskNoContext) void {
        JSC.markBinding(@src());
        if (cpp_task.getVM()) |vm| {
            vm.event_loop.refConcurrently();
        }
        const cpp = ConcurrentCppTask.new(.{ .cpp_task = cpp_task });
        JSC.WorkPool.schedule(&cpp.workpool_task);
    }
};

comptime {
    _ = ConcurrentCppTask.ConcurrentCppTask__createAndRun;
}

const bun = @import("bun");
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
