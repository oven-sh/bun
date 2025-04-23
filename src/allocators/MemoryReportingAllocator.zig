const MemoryReportingAllocator = @This();
const log = bun.Output.scoped(.MEM, false);

child_allocator: std.mem.Allocator,
memory_cost: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),

fn alloc(context: *anyopaque, n: usize, alignment: std.mem.Alignment, return_address: usize) ?[*]u8 {
    const this: *MemoryReportingAllocator = @alignCast(@ptrCast(context));
    const result = this.child_allocator.rawAlloc(n, alignment, return_address) orelse return null;
    _ = this.memory_cost.fetchAdd(n, .monotonic);
    if (comptime Environment.allow_assert)
        log("malloc({d}) = {d}", .{ n, this.memory_cost.raw });
    return result;
}

pub fn discard(this: *MemoryReportingAllocator, buf: []const u8) void {
    _ = this.memory_cost.fetchSub(buf.len, .monotonic);
    if (comptime Environment.allow_assert)
        log("discard({d}) = {d}", .{ buf.len, this.memory_cost.raw });
}

fn resize(context: *anyopaque, buf: []u8, alignment: std.mem.Alignment, new_len: usize, ret_addr: usize) bool {
    const this: *MemoryReportingAllocator = @alignCast(@ptrCast(context));
    if (this.child_allocator.rawResize(buf, alignment, new_len, ret_addr)) {
        _ = this.memory_cost.fetchAdd(new_len -| buf.len, .monotonic);
        if (comptime Environment.allow_assert)
            log("resize() = {d}", .{this.memory_cost.raw});
        return true;
    } else {
        return false;
    }
}

fn free(context: *anyopaque, buf: []u8, alignment: std.mem.Alignment, ret_addr: usize) void {
    const this: *MemoryReportingAllocator = @alignCast(@ptrCast(context));
    this.child_allocator.rawFree(buf, alignment, ret_addr);

    if (comptime Environment.allow_assert) {
        _ = this.memory_cost.fetchSub(buf.len, .monotonic);
        log("free({d}) = {d}", .{ buf.len, this.memory_cost.raw });
    }
}

pub fn wrap(this: *MemoryReportingAllocator, allocator_: std.mem.Allocator) std.mem.Allocator {
    this.* = .{
        .child_allocator = allocator_,
    };

    return this.allocator();
}

pub fn allocator(this: *MemoryReportingAllocator) std.mem.Allocator {
    return std.mem.Allocator{
        .ptr = this,
        .vtable = &MemoryReportingAllocator.VTable,
    };
}

pub fn report(this: *MemoryReportingAllocator, vm: *jsc.VM) void {
    const mem = this.memory_cost.load(.monotonic);
    if (mem > 0) {
        vm.reportExtraMemory(mem);
        if (comptime Environment.allow_assert)
            log("report({d})", .{mem});
    }
}

pub inline fn assert(this: *const MemoryReportingAllocator) void {
    if (comptime !Environment.allow_assert) {
        return;
    }

    const memory_cost = this.memory_cost.load(.monotonic);
    if (memory_cost > 0) {
        Output.panic("MemoryReportingAllocator still has {d} bytes allocated", .{memory_cost});
    }
}

pub const VTable = std.mem.Allocator.VTable{
    .alloc = &alloc,
    .resize = &resize,
    .remap = &std.mem.Allocator.noRemap,
    .free = &free,
};

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const Environment = bun.Environment;
const Output = bun.Output;
