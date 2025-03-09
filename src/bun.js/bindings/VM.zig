const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const Shimmer = JSC.Shimmer;

pub const VM = extern struct {
    pub const shim = Shimmer("JSC", "VM", @This());
    bytes: shim.Bytes,

    const cppFn = shim.cppFn;

    pub const include = "JavaScriptCore/VM.h";
    pub const name = "JSC::VM";
    pub const namespace = "JSC";

    pub const HeapType = enum(u8) {
        SmallHeap = 0,
        LargeHeap = 1,
    };

    pub fn create(heap_type: HeapType) *VM {
        return cppFn("create", .{@intFromEnum(heap_type)});
    }

    pub fn deinit(vm: *VM, global_object: *JSGlobalObject) void {
        return cppFn("deinit", .{ vm, global_object });
    }

    pub fn setControlFlowProfiler(vm: *VM, enabled: bool) void {
        return cppFn("setControlFlowProfiler", .{ vm, enabled });
    }

    pub fn isJITEnabled() bool {
        return cppFn("isJITEnabled", .{});
    }

    /// deprecated in favor of getAPILock to avoid an annoying callback wrapper
    pub fn holdAPILock(this: *VM, ctx: ?*anyopaque, callback: *const fn (ctx: ?*anyopaque) callconv(.C) void) void {
        cppFn("holdAPILock", .{ this, ctx, callback });
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

    pub fn deferGC(this: *VM, ctx: ?*anyopaque, callback: *const fn (ctx: ?*anyopaque) callconv(.C) void) void {
        cppFn("deferGC", .{ this, ctx, callback });
    }
    extern fn JSC__VM__reportExtraMemory(*VM, usize) void;
    pub fn reportExtraMemory(this: *VM, size: usize) void {
        JSC.markBinding(@src());
        JSC__VM__reportExtraMemory(this, size);
    }

    pub fn deleteAllCode(
        vm: *VM,
        global_object: *JSGlobalObject,
    ) void {
        return cppFn("deleteAllCode", .{ vm, global_object });
    }

    pub fn whenIdle(
        vm: *VM,
        callback: *const fn (...) callconv(.C) void,
    ) void {
        return cppFn("whenIdle", .{ vm, callback });
    }

    pub fn shrinkFootprint(
        vm: *VM,
    ) void {
        return cppFn("shrinkFootprint", .{
            vm,
        });
    }

    pub fn runGC(vm: *VM, sync: bool) usize {
        return cppFn("runGC", .{
            vm,
            sync,
        });
    }

    pub fn heapSize(vm: *VM) usize {
        return cppFn("heapSize", .{
            vm,
        });
    }

    pub fn collectAsync(vm: *VM) void {
        return cppFn("collectAsync", .{
            vm,
        });
    }

    pub fn setExecutionForbidden(vm: *VM, forbidden: bool) void {
        cppFn("setExecutionForbidden", .{ vm, forbidden });
    }

    pub fn setExecutionTimeLimit(vm: *VM, timeout: f64) void {
        return cppFn("setExecutionTimeLimit", .{ vm, timeout });
    }

    pub fn clearExecutionTimeLimit(vm: *VM) void {
        return cppFn("clearExecutionTimeLimit", .{vm});
    }

    pub fn executionForbidden(vm: *VM) bool {
        return cppFn("executionForbidden", .{
            vm,
        });
    }

    // These four functions fire VM traps. To understand what that means, see VMTraps.h for a giant explainer.
    // These may be called concurrently from another thread.

    /// Fires NeedTermination Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedTermination(vm: *VM) void {
        cppFn("notifyNeedTermination", .{vm});
    }
    /// Fires NeedWatchdogCheck Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedWatchdogCheck(vm: *VM) void {
        cppFn("notifyNeedWatchdogCheck", .{vm});
    }
    /// Fires NeedDebuggerBreak Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedDebuggerBreak(vm: *VM) void {
        cppFn("notifyNeedDebuggerBreak", .{vm});
    }
    /// Fires NeedShellTimeoutCheck Trap. Thread safe. See JSC's "VMTraps.h" for explaination on traps.
    pub fn notifyNeedShellTimeoutCheck(vm: *VM) void {
        cppFn("notifyNeedShellTimeoutCheck", .{vm});
    }

    pub fn isEntered(vm: *VM) bool {
        return cppFn("isEntered", .{
            vm,
        });
    }

    // manual extern to workaround shimmer limitation
    // shimmer doesnt let you change the return type or make it non-pub
    extern fn JSC__VM__throwError(*VM, *JSGlobalObject, JSValue) void;
    pub fn throwError(vm: *VM, global_object: *JSGlobalObject, value: JSValue) void {
        JSC__VM__throwError(vm, global_object, value);
    }

    pub fn releaseWeakRefs(vm: *VM) void {
        return cppFn("releaseWeakRefs", .{vm});
    }

    pub fn drainMicrotasks(
        vm: *VM,
    ) void {
        return cppFn("drainMicrotasks", .{
            vm,
        });
    }

    pub fn externalMemorySize(vm: *VM) usize {
        return cppFn("externalMemorySize", .{vm});
    }

    /// `RESOURCE_USAGE` build option in JavaScriptCore is required for this function
    /// This is faster than checking the heap size
    pub fn blockBytesAllocated(vm: *VM) usize {
        return cppFn("blockBytesAllocated", .{vm});
    }

    pub fn performOpportunisticallyScheduledTasks(vm: *VM, until: f64) void {
        cppFn("performOpportunisticallyScheduledTasks", .{ vm, until });
    }

    pub const Extern = [_][]const u8{
        "setControlFlowProfiler",
        "collectAsync",
        "externalMemorySize",
        "blockBytesAllocated",
        "heapSize",
        "releaseWeakRefs",
        "throwError",
        "deferGC",
        "holdAPILock",
        "runGC",
        "generateHeapSnapshot",
        "isJITEnabled",
        "deleteAllCode",
        "create",
        "deinit",
        "setExecutionForbidden",
        "executionForbidden",
        "isEntered",
        "throwError",
        "drainMicrotasks",
        "whenIdle",
        "shrinkFootprint",
        "setExecutionTimeLimit",
        "clearExecutionTimeLimit",
        "notifyNeedTermination",
        "notifyNeedWatchdogCheck",
        "notifyNeedDebuggerBreak",
        "notifyNeedShellTimeoutCheck",
    };
};
