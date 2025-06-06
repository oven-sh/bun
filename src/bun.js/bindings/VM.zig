const bun = @import("bun");
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;

pub const VM = opaque {
    pub const HeapType = enum(u8) {
        SmallHeap = 0,
        LargeHeap = 1,
    };

    extern fn JSC__VM__create(heap_type: u8) *VM;
    pub fn create(heap_type: HeapType) *VM {
        return JSC__VM__create(@intFromEnum(heap_type));
    }

    extern fn JSC__VM__deinit(vm: *VM, global_object: *JSGlobalObject) void;
    pub fn deinit(vm: *VM, global_object: *JSGlobalObject) void {
        return JSC__VM__deinit(vm, global_object);
    }

    extern fn JSC__VM__setControlFlowProfiler(vm: *VM, enabled: bool) void;
    pub fn setControlFlowProfiler(vm: *VM, enabled: bool) void {
        return JSC__VM__setControlFlowProfiler(vm, enabled);
    }

    extern fn JSC__VM__isJITEnabled() bool;
    pub fn isJITEnabled() bool {
        return JSC__VM__isJITEnabled();
    }

    extern fn JSC__VM__hasExecutionTimeLimit(vm: *VM) bool;
    pub fn hasExecutionTimeLimit(vm: *VM) bool {
        return JSC__VM__hasExecutionTimeLimit(vm);
    }

    /// deprecated in favor of getAPILock to avoid an annoying callback wrapper
    extern fn JSC__VM__holdAPILock(this: *VM, ctx: ?*anyopaque, callback: *const fn (ctx: ?*anyopaque) callconv(.C) void) void;
    /// deprecated in favor of getAPILock to avoid an annoying callback wrapper
    pub fn holdAPILock(this: *VM, ctx: ?*anyopaque, callback: *const fn (ctx: ?*anyopaque) callconv(.C) void) void {
        JSC__VM__holdAPILock(this, ctx, callback);
    }

    extern fn JSC__VM__getAPILock(vm: *VM) void;
    extern fn JSC__VM__releaseAPILock(vm: *VM) void;

    /// See `JSLock.h` in WebKit for more detail on how the API lock prevents races.
    pub fn getAPILock(vm: *VM) Lock {
        JSC__VM__getAPILock(vm);
        return .{ .vm = vm };
    }

    pub const Lock = struct {
        vm: *VM,
        pub fn release(lock: Lock) void {
            JSC__VM__releaseAPILock(lock.vm);
        }
    };

    extern fn JSC__VM__deferGC(this: *VM, ctx: ?*anyopaque, callback: *const fn (ctx: ?*anyopaque) callconv(.C) void) void;
    pub fn deferGC(this: *VM, ctx: ?*anyopaque, callback: *const fn (ctx: ?*anyopaque) callconv(.C) void) void {
        JSC__VM__deferGC(this, ctx, callback);
    }
    extern fn JSC__VM__reportExtraMemory(*VM, usize) void;
    pub fn reportExtraMemory(this: *VM, size: usize) void {
        JSC.markBinding(@src());
        JSC__VM__reportExtraMemory(this, size);
    }

    extern fn JSC__VM__deleteAllCode(vm: *VM, global_object: *JSGlobalObject) void;
    pub fn deleteAllCode(
        vm: *VM,
        global_object: *JSGlobalObject,
    ) void {
        return JSC__VM__deleteAllCode(vm, global_object);
    }

    extern fn JSC__VM__whenIdle(vm: *VM, callback: *const fn (...) callconv(.C) void) void;
    pub fn whenIdle(
        vm: *VM,
        callback: *const fn (...) callconv(.C) void,
    ) void {
        return JSC__VM__whenIdle(vm, callback);
    }

    extern fn JSC__VM__shrinkFootprint(vm: *VM) void;
    pub fn shrinkFootprint(
        vm: *VM,
    ) void {
        return JSC__VM__shrinkFootprint(vm);
    }

    extern fn JSC__VM__runGC(vm: *VM, sync: bool) usize;
    pub fn runGC(vm: *VM, sync: bool) usize {
        return JSC__VM__runGC(vm, sync);
    }

    extern fn JSC__VM__heapSize(vm: *VM) usize;
    pub fn heapSize(vm: *VM) usize {
        return JSC__VM__heapSize(vm);
    }

    extern fn JSC__VM__collectAsync(vm: *VM) void;
    pub fn collectAsync(vm: *VM) void {
        return JSC__VM__collectAsync(vm);
    }

    extern fn JSC__VM__setExecutionForbidden(vm: *VM, forbidden: bool) void;
    pub fn setExecutionForbidden(vm: *VM, forbidden: bool) void {
        JSC__VM__setExecutionForbidden(vm, forbidden);
    }

    extern fn JSC__VM__setExecutionTimeLimit(vm: *VM, timeout: f64) void;
    pub fn setExecutionTimeLimit(vm: *VM, timeout: f64) void {
        return JSC__VM__setExecutionTimeLimit(vm, timeout);
    }

    extern fn JSC__VM__clearExecutionTimeLimit(vm: *VM) void;
    pub fn clearExecutionTimeLimit(vm: *VM) void {
        return JSC__VM__clearExecutionTimeLimit(vm);
    }

    extern fn JSC__VM__executionForbidden(vm: *VM) bool;
    pub fn executionForbidden(vm: *VM) bool {
        return JSC__VM__executionForbidden(vm);
    }

    // These four functions fire VM traps. To understand what that means, see VMTraps.h for a giant explainer.
    // These may be called concurrently from another thread.

    extern fn JSC__VM__notifyNeedTermination(vm: *VM) void;

    /// Fires NeedTermination Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedTermination(vm: *VM) void {
        JSC__VM__notifyNeedTermination(vm);
    }

    extern fn JSC__VM__notifyNeedWatchdogCheck(vm: *VM) void;

    /// Fires NeedWatchdogCheck Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedWatchdogCheck(vm: *VM) void {
        JSC__VM__notifyNeedWatchdogCheck(vm);
    }

    extern fn JSC__VM__notifyNeedDebuggerBreak(vm: *VM) void;

    /// Fires NeedDebuggerBreak Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedDebuggerBreak(vm: *VM) void {
        JSC__VM__notifyNeedDebuggerBreak(vm);
    }

    extern fn JSC__VM__notifyNeedShellTimeoutCheck(vm: *VM) void;

    /// Fires NeedShellTimeoutCheck Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedShellTimeoutCheck(vm: *VM) void {
        JSC__VM__notifyNeedShellTimeoutCheck(vm);
    }

    extern fn JSC__VM__isEntered(vm: *VM) bool;
    pub fn isEntered(vm: *VM) bool {
        return JSC__VM__isEntered(vm);
    }

    extern fn JSC__VM__throwError(*VM, *JSGlobalObject, JSValue) void;
    pub fn throwError(vm: *VM, global_object: *JSGlobalObject, value: JSValue) void {
        JSC__VM__throwError(vm, global_object, value);
    }

    extern fn JSC__VM__releaseWeakRefs(vm: *VM) void;
    pub fn releaseWeakRefs(vm: *VM) void {
        return JSC__VM__releaseWeakRefs(vm);
    }

    extern fn JSC__VM__drainMicrotasks(vm: *VM) void;
    pub fn drainMicrotasks(
        vm: *VM,
    ) void {
        return JSC__VM__drainMicrotasks(vm);
    }

    extern fn JSC__VM__externalMemorySize(vm: *VM) usize;
    pub fn externalMemorySize(vm: *VM) usize {
        return JSC__VM__externalMemorySize(vm);
    }

    extern fn JSC__VM__blockBytesAllocated(vm: *VM) usize;

    /// `RESOURCE_USAGE` build option in JavaScriptCore is required for this function
    /// This is faster than checking the heap size
    pub fn blockBytesAllocated(vm: *VM) usize {
        return JSC__VM__blockBytesAllocated(vm);
    }

    extern fn JSC__VM__performOpportunisticallyScheduledTasks(vm: *VM, until: f64) void;
    pub fn performOpportunisticallyScheduledTasks(vm: *VM, until: f64) void {
        JSC__VM__performOpportunisticallyScheduledTasks(vm, until);
    }
};
