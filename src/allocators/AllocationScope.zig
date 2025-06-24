//! AllocationScope wraps another allocator, providing leak and invalid free assertions.
//! It also allows measuring how much memory a scope has allocated.
const AllocationScope = @This();

pub const enabled = bun.Environment.isDebug;

parent: Allocator,
state: if (enabled) struct {
    mutex: bun.Mutex,
    total_memory_allocated: usize,
    allocations: std.AutoHashMapUnmanaged([*]const u8, Allocation),
    frees: std.AutoArrayHashMapUnmanaged([*]const u8, Free),
    /// Once `frees` fills up, entries are overwritten from start to end.
    free_overwrite_index: std.math.IntFittingRange(0, max_free_tracking + 1),
} else void,

pub const max_free_tracking = 2048 - 1;

pub const Allocation = struct {
    allocated_at: StoredTrace,
    len: usize,
    extra: Extra,
};

pub const Free = struct {
    allocated_at: StoredTrace,
    freed_at: StoredTrace,
};

pub const Extra = union(enum) {
    none,
    ref_count: *RefCountDebugData(false),
    ref_count_threadsafe: *RefCountDebugData(true),

    const RefCountDebugData = @import("../ptr/ref_count.zig").DebugData;
};

pub fn init(parent: Allocator) AllocationScope {
    return if (enabled)
        .{
            .parent = parent,
            .state = .{
                .total_memory_allocated = 0,
                .allocations = .empty,
                .frees = .empty,
                .free_overwrite_index = 0,
                .mutex = .{},
            },
        }
    else
        .{ .parent = parent, .state = {} };
}

pub fn deinit(scope: *AllocationScope) void {
    if (enabled) {
        scope.state.mutex.lock();
        defer scope.state.allocations.deinit(scope.parent);
        const count = scope.state.allocations.count();
        if (count == 0) return;
        Output.errGeneric("Allocation scope leaked {d} allocations ({})", .{
            count,
            bun.fmt.size(scope.state.total_memory_allocated, .{}),
        });
        var it = scope.state.allocations.iterator();
        var n: usize = 0;
        while (it.next()) |entry| {
            Output.prettyErrorln("- {any}, len {d}, at:", .{ entry.key_ptr.*, entry.value_ptr.len });
            bun.crash_handler.dumpStackTrace(entry.value_ptr.allocated_at.trace(), trace_limits);

            switch (entry.value_ptr.extra) {
                .none => {},
                inline else => |t| t.onAllocationLeak(@constCast(entry.key_ptr.*[0..entry.value_ptr.len])),
            }

            n += 1;
            if (n >= 8) {
                Output.prettyErrorln("(only showing first 10 leaks)", .{});
                break;
            }
        }
        Output.panic("Allocation scope leaked {}", .{bun.fmt.size(scope.state.total_memory_allocated, .{})});
    }
}

pub fn allocator(scope: *AllocationScope) Allocator {
    return if (enabled) .{ .ptr = scope, .vtable = &vtable } else scope.parent;
}

const vtable: Allocator.VTable = .{
    .alloc = alloc,
    .resize = &std.mem.Allocator.noResize,
    .remap = &std.mem.Allocator.noRemap,
    .free = free,
};

// Smaller traces since AllocationScope prints so many
pub const trace_limits: bun.crash_handler.WriteStackTraceLimits = .{
    .frame_count = 6,
    .stop_at_jsc_llint = true,
    .skip_stdlib = true,
};
pub const free_trace_limits: bun.crash_handler.WriteStackTraceLimits = .{
    .frame_count = 3,
    .stop_at_jsc_llint = true,
    .skip_stdlib = true,
};

fn alloc(ctx: *anyopaque, len: usize, alignment: std.mem.Alignment, ret_addr: usize) ?[*]u8 {
    const scope: *AllocationScope = @ptrCast(@alignCast(ctx));
    scope.state.mutex.lock();
    defer scope.state.mutex.unlock();
    scope.state.allocations.ensureUnusedCapacity(scope.parent, 1) catch
        return null;
    const result = scope.parent.vtable.alloc(scope.parent.ptr, len, alignment, ret_addr) orelse
        return null;
    scope.trackAllocationAssumeCapacity(result[0..len], ret_addr, .none);
    return result;
}

fn trackAllocationAssumeCapacity(scope: *AllocationScope, buf: []const u8, ret_addr: usize, extra: Extra) void {
    const trace = StoredTrace.capture(ret_addr);
    scope.state.allocations.putAssumeCapacityNoClobber(buf.ptr, .{
        .allocated_at = trace,
        .len = buf.len,
        .extra = extra,
    });
    scope.state.total_memory_allocated += buf.len;
}

fn free(ctx: *anyopaque, buf: []u8, alignment: std.mem.Alignment, ret_addr: usize) void {
    const scope: *AllocationScope = @ptrCast(@alignCast(ctx));
    scope.state.mutex.lock();
    defer scope.state.mutex.unlock();
    const invalid = scope.trackFreeAssumeLocked(buf, ret_addr);

    scope.parent.vtable.free(scope.parent.ptr, buf, alignment, ret_addr);

    // If asan did not catch the free, panic now.
    if (invalid) @panic("Invalid free");
}

fn trackFreeAssumeLocked(scope: *AllocationScope, buf: []const u8, ret_addr: usize) bool {
    if (scope.state.allocations.fetchRemove(buf.ptr)) |entry| {
        scope.state.total_memory_allocated -= entry.value.len;

        free_entry: {
            scope.state.frees.put(scope.parent, buf.ptr, .{
                .allocated_at = entry.value.allocated_at,
                .freed_at = StoredTrace.capture(ret_addr),
            }) catch break :free_entry;
            // Store a limited amount of free entries
            if (scope.state.frees.count() >= max_free_tracking) {
                const i = scope.state.free_overwrite_index;
                scope.state.free_overwrite_index = @mod(scope.state.free_overwrite_index + 1, max_free_tracking);
                scope.state.frees.swapRemoveAt(i);
            }
        }
        return false;
    } else {
        bun.Output.errGeneric("Invalid free, pointer {any}, len {d}", .{ buf.ptr, buf.len });

        if (scope.state.frees.get(buf.ptr)) |free_entry_const| {
            var free_entry = free_entry_const;
            bun.Output.printErrorln("Pointer allocated here:", .{});
            bun.crash_handler.dumpStackTrace(free_entry.allocated_at.trace(), trace_limits);
            bun.Output.printErrorln("Pointer first freed here:", .{});
            bun.crash_handler.dumpStackTrace(free_entry.freed_at.trace(), free_trace_limits);
        }

        // do not panic because address sanitizer will catch this case better.
        // the log message is in case there is a situation where address
        // sanitizer does not catch the invalid free.

        return true;
    }
}

pub fn assertOwned(scope: *AllocationScope, ptr: anytype) void {
    if (!enabled) return;
    const cast_ptr: [*]const u8 = @ptrCast(switch (@typeInfo(@TypeOf(ptr)).pointer.size) {
        .c, .one, .many => ptr,
        .slice => if (ptr.len > 0) ptr.ptr else return,
    });
    scope.state.mutex.lock();
    defer scope.state.mutex.unlock();
    _ = scope.state.allocations.getPtr(cast_ptr) orelse
        @panic("this pointer was not owned by the allocation scope");
}

pub fn assertUnowned(scope: *AllocationScope, ptr: anytype) void {
    if (!enabled) return;
    const cast_ptr: [*]const u8 = @ptrCast(switch (@typeInfo(@TypeOf(ptr)).pointer.size) {
        .c, .one, .many => ptr,
        .slice => if (ptr.len > 0) ptr.ptr else return,
    });
    scope.state.mutex.lock();
    defer scope.state.mutex.unlock();
    if (scope.state.allocations.getPtr(cast_ptr)) |owned| {
        Output.debugWarn("Pointer allocated here:");
        bun.crash_handler.dumpStackTrace(owned.allocated_at.trace(), trace_limits, trace_limits);
    }
    @panic("this pointer was owned by the allocation scope when it was not supposed to be");
}

/// Track an arbitrary pointer. Extra data can be stored in the allocation,
/// which will be printed when a leak is detected.
pub fn trackExternalAllocation(scope: *AllocationScope, ptr: []const u8, ret_addr: ?usize, extra: Extra) void {
    if (!enabled) return;
    scope.state.mutex.lock();
    defer scope.state.mutex.unlock();
    scope.state.allocations.ensureUnusedCapacity(scope.parent, 1) catch bun.outOfMemory();
    trackAllocationAssumeCapacity(scope, ptr, ptr.len, ret_addr orelse @returnAddress(), extra);
}

/// Call when the pointer from `trackExternalAllocation` is freed.
/// Returns true if the free was invalid.
pub fn trackExternalFree(scope: *AllocationScope, ptr: []const u8, ret_addr: ?usize) bool {
    if (!enabled) return;
    scope.state.mutex.lock();
    defer scope.state.mutex.unlock();
    return trackFreeAssumeLocked(scope, ptr, ret_addr orelse @returnAddress());
}

pub fn setPointerExtra(scope: *AllocationScope, ptr: *anyopaque, extra: Extra) void {
    if (!enabled) return;
    scope.state.mutex.lock();
    defer scope.state.mutex.unlock();
    const allocation = scope.state.allocations.getPtr(ptr) orelse
        @panic("Pointer not owned by allocation scope");
    allocation.extra = extra;
}

pub inline fn downcast(a: Allocator) ?*AllocationScope {
    return if (enabled and a.vtable == &vtable)
        @ptrCast(@alignCast(a.ptr))
    else
        null;
}

const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("bun");
const Output = bun.Output;
const StoredTrace = bun.crash_handler.StoredTrace;
