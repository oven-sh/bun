const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const VM = JSC.VM;

pub export fn Bun__isBusyDoingImportantWork(vm: *JSC.VirtualMachine) bool {
    const loop = vm.eventLoop();
    if (loop.is_doing_something_important) {
        return true;
    }

    if (loop.tasks.count > 0) {
        return true;
    }

    if (loop.immediate_tasks.count > 0 or loop.next_immediate_tasks.count > 0) {
        return true;
    }

    if (loop.concurrent_tasks.peek() > 0) {
        return true;
    }

    return false;
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
    extern "c" fn Bun__GCController__create(vm: *VM) *GCController;
    extern "c" fn Bun__GCController__performOpportunisticGC(controller: *GCController) void;
    extern "c" fn Bun__GCController__getMetrics(controller: *GCController, incrementalSweepCount: ?*usize, edenGCCount: ?*usize, fullGCCount: ?*usize, totalSweepTimeMs: ?*f64, maxSweepTimeMs: ?*f64) void;

    fn create(vm: *VM) ?*GCController {
        return Bun__GCController__create(vm);
    }

    pub fn performOpportunisticGC(this: *GCController) void {
        Bun__GCController__performOpportunisticGC(this);
    }

    pub fn getMetrics(this: *GCController, incrementalSweepCount: ?*usize, edenGCCount: ?*usize, fullGCCount: ?*usize, totalSweepTimeMs: ?*f64, maxSweepTimeMs: ?*f64) void {
        Bun__GCController__getMetrics(this, incrementalSweepCount, edenGCCount, fullGCCount, totalSweepTimeMs, maxSweepTimeMs);
    }
};
