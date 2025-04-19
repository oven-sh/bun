const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const VM = JSC.VM;

pub export fn Bun__isBusyDoingImportantWork(vm: *JSC.VirtualMachine) bool {
    const loop = vm.eventLoop();
    return loop.is_doing_something_important or
        loop.tasks.count > 0 or
        loop.immediate_tasks.items.len > 0 or loop.next_immediate_tasks.items.len > 0 or
        loop.concurrent_tasks.peek() > 0;
}

// Wrapper for the Bun::GCController C++ class
pub const GCController = opaque {
    pub export fn Bun__GCController__setup(ptr: *GCController) void {
        const vm = JSC.VirtualMachine.get();
        vm.gc_controller = ptr;
    }

    pub fn performGC(this: *GCController) void {
        this.performOpportunisticGC();
    }

    extern "c" fn Bun__GCController__initialize(controller: *GCController) void;
    extern "c" fn Bun__GCController__get(vm: *VM) *GCController;
    extern "c" fn Bun__GCController__performOpportunisticGC(controller: *GCController) void;
    extern "c" fn Bun__GCController__getMetrics(controller: *GCController, incrementalSweepCount: ?*usize, edenGCCount: ?*usize, fullGCCount: ?*usize, totalSweepTimeMs: ?*f64, maxSweepTimeMs: ?*f64) void;

    fn get(vm: *VM) *GCController {
        return Bun__GCController__get(vm);
    }

    pub fn performOpportunisticGC(this: *GCController) void {
        Bun__GCController__performOpportunisticGC(this);
    }

    pub fn getMetrics(this: *GCController, incrementalSweepCount: ?*usize, edenGCCount: ?*usize, fullGCCount: ?*usize, totalSweepTimeMs: ?*f64, maxSweepTimeMs: ?*f64) void {
        Bun__GCController__getMetrics(this, incrementalSweepCount, edenGCCount, fullGCCount, totalSweepTimeMs, maxSweepTimeMs);
    }
};
