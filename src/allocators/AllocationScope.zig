//! AllocationScope wraps another allocator, providing leak and invalid free assertions.
//! It also allows measuring how much memory a scope has allocated.
//!
//! AllocationScope is conceptually a pointer, so it can be moved without invalidating allocations.
//! Therefore, it isn't necessary to pass an AllocationScope by pointer.

const Self = @This();

pub const enabled = bun.Environment.enableAllocScopes;

internal_state: if (enabled) *State else Allocator,

const State = struct {
    parent: Allocator,
    mutex: bun.Mutex,
    total_memory_allocated: usize,
    allocations: std.AutoHashMapUnmanaged([*]const u8, Allocation),
    frees: std.AutoArrayHashMapUnmanaged([*]const u8, Free),
    /// Once `frees` fills up, entries are overwritten from start to end.
    free_overwrite_index: std.math.IntFittingRange(0, max_free_tracking + 1),
};

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

pub fn init(parent_alloc: Allocator) Self {
    const state = if (comptime enabled)
        bun.new(State, .{
            .parent = parent_alloc,
            .total_memory_allocated = 0,
            .allocations = .empty,
            .frees = .empty,
            .free_overwrite_index = 0,
            .mutex = .{},
        })
    else
        parent_alloc;
    return .{ .internal_state = state };
}

pub fn deinit(scope: Self) void {
    if (comptime !enabled) return;

    const state = scope.internal_state;
    state.mutex.lock();
    defer bun.destroy(state);
    defer state.allocations.deinit(state.parent);
    const count = state.allocations.count();
    if (count == 0) return;
    Output.errGeneric("Allocation scope leaked {d} allocations ({})", .{
        count,
        bun.fmt.size(state.total_memory_allocated, .{}),
    });
    var it = state.allocations.iterator();
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
    Output.panic("Allocation scope leaked {}", .{bun.fmt.size(state.total_memory_allocated, .{})});
}

pub fn allocator(scope: Self) Allocator {
    const state = scope.internal_state;
    return if (comptime enabled) .{ .ptr = state, .vtable = &vtable } else state;
}

pub fn parent(scope: Self) Allocator {
    const state = scope.internal_state;
    return if (comptime enabled) state.parent else state;
}

pub fn total(self: Self) usize {
    if (comptime !enabled) @compileError("AllocationScope must be enabled");
    return self.internal_state.total_memory_allocated;
}

pub fn numAllocations(self: Self) usize {
    if (comptime !enabled) @compileError("AllocationScope must be enabled");
    return self.internal_state.allocations.count();
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
    const state: *State = @ptrCast(@alignCast(ctx));

    state.mutex.lock();
    defer state.mutex.unlock();
    state.allocations.ensureUnusedCapacity(state.parent, 1) catch
        return null;
    const result = state.parent.vtable.alloc(state.parent.ptr, len, alignment, ret_addr) orelse
        return null;
    trackAllocationAssumeCapacity(state, result[0..len], ret_addr, .none);
    return result;
}

fn trackAllocationAssumeCapacity(state: *State, buf: []const u8, ret_addr: usize, extra: Extra) void {
    const trace = StoredTrace.capture(ret_addr);
    state.allocations.putAssumeCapacityNoClobber(buf.ptr, .{
        .allocated_at = trace,
        .len = buf.len,
        .extra = extra,
    });
    state.total_memory_allocated += buf.len;
}

fn free(ctx: *anyopaque, buf: []u8, alignment: std.mem.Alignment, ret_addr: usize) void {
    const state: *State = @ptrCast(@alignCast(ctx));
    state.mutex.lock();
    defer state.mutex.unlock();
    const invalid = trackFreeAssumeLocked(state, buf, ret_addr);

    state.parent.vtable.free(state.parent.ptr, buf, alignment, ret_addr);

    // If asan did not catch the free, panic now.
    if (invalid) @panic("Invalid free");
}

fn trackFreeAssumeLocked(state: *State, buf: []const u8, ret_addr: usize) bool {
    if (state.allocations.fetchRemove(buf.ptr)) |entry| {
        state.total_memory_allocated -= entry.value.len;

        free_entry: {
            state.frees.put(state.parent, buf.ptr, .{
                .allocated_at = entry.value.allocated_at,
                .freed_at = StoredTrace.capture(ret_addr),
            }) catch break :free_entry;
            // Store a limited amount of free entries
            if (state.frees.count() >= max_free_tracking) {
                const i = state.free_overwrite_index;
                state.free_overwrite_index = @mod(state.free_overwrite_index + 1, max_free_tracking);
                state.frees.swapRemoveAt(i);
            }
        }
        return false;
    } else {
        bun.Output.errGeneric("Invalid free, pointer {any}, len {d}", .{ buf.ptr, buf.len });

        if (state.frees.get(buf.ptr)) |free_entry_const| {
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

pub fn assertOwned(scope: Self, ptr: anytype) void {
    if (comptime !enabled) return;
    const cast_ptr: [*]const u8 = @ptrCast(switch (@typeInfo(@TypeOf(ptr)).pointer.size) {
        .c, .one, .many => ptr,
        .slice => if (ptr.len > 0) ptr.ptr else return,
    });
    const state = scope.internal_state;
    state.mutex.lock();
    defer state.mutex.unlock();
    _ = state.allocations.getPtr(cast_ptr) orelse
        @panic("this pointer was not owned by the allocation scope");
}

pub fn assertUnowned(scope: Self, ptr: anytype) void {
    if (comptime !enabled) return;
    const cast_ptr: [*]const u8 = @ptrCast(switch (@typeInfo(@TypeOf(ptr)).pointer.size) {
        .c, .one, .many => ptr,
        .slice => if (ptr.len > 0) ptr.ptr else return,
    });
    const state = scope.internal_state;
    state.mutex.lock();
    defer state.mutex.unlock();
    if (state.allocations.getPtr(cast_ptr)) |owned| {
        Output.warn("Owned pointer allocated here:");
        bun.crash_handler.dumpStackTrace(owned.allocated_at.trace(), trace_limits, trace_limits);
    }
    @panic("this pointer was owned by the allocation scope when it was not supposed to be");
}

/// Track an arbitrary pointer. Extra data can be stored in the allocation,
/// which will be printed when a leak is detected.
pub fn trackExternalAllocation(scope: Self, ptr: []const u8, ret_addr: ?usize, extra: Extra) void {
    if (comptime !enabled) return;
    const state = scope.internal_state;
    state.mutex.lock();
    defer state.mutex.unlock();
    state.allocations.ensureUnusedCapacity(state.parent, 1) catch bun.outOfMemory();
    trackAllocationAssumeCapacity(state, ptr, ptr.len, ret_addr orelse @returnAddress(), extra);
}

/// Call when the pointer from `trackExternalAllocation` is freed.
/// Returns true if the free was invalid.
pub fn trackExternalFree(scope: Self, slice: anytype, ret_addr: ?usize) bool {
    if (comptime !enabled) return false;
    const ptr: []const u8 = switch (@typeInfo(@TypeOf(slice))) {
        .pointer => |p| switch (p.size) {
            .slice => brk: {
                if (p.child != u8) @compileError("This function only supports []u8 or [:sentinel]u8 types, you passed in: " ++ @typeName(@TypeOf(slice)));
                if (p.sentinel_ptr == null) break :brk slice;
                // Ensure we include the sentinel value
                break :brk slice[0 .. slice.len + 1];
            },
            else => @compileError("This function only supports []u8 or [:sentinel]u8 types, you passed in: " ++ @typeName(@TypeOf(slice))),
        },
        else => @compileError("This function only supports []u8 or [:sentinel]u8 types, you passed in: " ++ @typeName(@TypeOf(slice))),
    };
    // Empty slice usually means invalid pointer
    if (ptr.len == 0) return false;
    const state = scope.internal_state;
    state.mutex.lock();
    defer state.mutex.unlock();
    return trackFreeAssumeLocked(state, ptr, ret_addr orelse @returnAddress());
}

pub fn setPointerExtra(scope: Self, ptr: *anyopaque, extra: Extra) void {
    if (comptime !enabled) return;
    const state = scope.internal_state;
    state.mutex.lock();
    defer state.mutex.unlock();
    const allocation = state.allocations.getPtr(ptr) orelse
        @panic("Pointer not owned by allocation scope");
    allocation.extra = extra;
}

pub inline fn downcast(a: Allocator) ?Self {
    return if (enabled and a.vtable == &vtable)
        .{ .internal_state = @ptrCast(@alignCast(a.ptr)) }
    else
        null;
}

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Output = bun.Output;
const StoredTrace = bun.crash_handler.StoredTrace;
