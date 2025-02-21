//! AllocationScope wraps another allocator, providing leak and invalid free assertions.
//! It also allows measuring how much an
const AllocationScope = @This();

pub const enabled = bun.Environment.isDebug;

parent: Allocator,
state: if (enabled) struct {
    total_memory_allocated: usize,
    allocations: std.AutoHashMapUnmanaged([*]u8, Entry),
} else void,

pub const Entry = struct {
    allocated_at: StoredTrace,
    len: usize,
};

pub fn init(parent: Allocator) AllocationScope {
    return if (enabled)
        .{
            .parent = parent,
            .state = .{
                .total_memory_allocated = 0,
                .allocations = .empty,
            },
        }
    else
        .{ .parent = parent, .state = {} };
}

pub fn deinit(scope: *AllocationScope) void {
    if (enabled) {
        defer scope.state.allocations.deinit(scope.parent);
        const count = scope.state.allocations.count();
        if (count == 0) return;
        const Output = bun.Output;
        Output.debugWarn("Allocation scope leaked {d} allocations ({d} bytes)", .{ count, scope.state.total_memory_allocated });
        var it = scope.state.allocations.iterator();
        while (it.next()) |entry| {
            Output.debugWarn("- {any}, len {d}, at:", .{ entry.key_ptr.*, entry.value_ptr.len });
            bun.crash_handler.dumpStackTrace(entry.value_ptr.allocated_at.trace());
        }
    }
}

pub fn allocator(scope: *AllocationScope) Allocator {
    return if (enabled) .{ .ptr = scope, .vtable = &vtable } else scope.parent;
}

const vtable: Allocator.VTable = .{
    .alloc = alloc,
    .resize = resize,
    .free = free,
};

fn alloc(ctx: *anyopaque, len: usize, ptr_align: u8, ret_addr: usize) ?[*]u8 {
    const scope: *AllocationScope = @ptrCast(@alignCast(ctx));
    scope.state.allocations.ensureUnusedCapacity(scope.parent, 1) catch
        return null;
    const result = scope.parent.vtable.alloc(scope.parent.ptr, len, ptr_align, ret_addr) orelse
        return null;
    const trace = StoredTrace.capture(ret_addr);
    scope.state.allocations.putAssumeCapacityNoClobber(result, .{
        .allocated_at = trace,
        .len = len,
    });
    scope.state.total_memory_allocated += len;
    return result;
}

fn resize(ctx: *anyopaque, buf: []u8, buf_align: u8, new_len: usize, ret_addr: usize) bool {
    const scope: *AllocationScope = @ptrCast(@alignCast(ctx));
    return scope.parent.vtable.resize(scope.parent.ptr, buf, buf_align, new_len, ret_addr);
}

fn free(ctx: *anyopaque, buf: []u8, buf_align: u8, ret_addr: usize) void {
    const scope: *AllocationScope = @ptrCast(@alignCast(ctx));
    if (scope.state.allocations.fetchRemove(buf.ptr)) |entry| {
        scope.state.total_memory_allocated -= entry.value.len;
    } else {
        bun.Output.debugWarn("Invalid free, pointer {any}, len {d}", .{ buf.ptr, buf.len });
        // do not panic because address sanitizer will catch this case better.
        // the log message is in case there is a situation where address
        // sanitizer does not catch the invalid free.
    }
    return scope.parent.vtable.free(scope.parent.ptr, buf, buf_align, ret_addr);
}

const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const StoredTrace = bun.crash_handler.StoredTrace;
