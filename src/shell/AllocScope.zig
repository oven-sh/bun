//! This is just a wrapper around `bun.AllocationScope` that ensures that it is
//! zero-cost in release builds.

const AllocScope = @This();

__scope: if (bun.Environment.enableAllocScopes) bun.AllocationScope else void,

pub fn beginScope(alloc: std.mem.Allocator) AllocScope {
    if (comptime bun.Environment.enableAllocScopes) {
        return .{ .__scope = bun.AllocationScope.init(alloc) };
    }
    return .{ .__scope = {} };
}

pub fn endScope(this: *AllocScope) void {
    if (comptime bun.Environment.enableAllocScopes) {
        this.__scope.deinit();
    }
}

pub fn leakSlice(this: *AllocScope, memory: anytype) void {
    if (comptime bun.Environment.enableAllocScopes) {
        _ = @typeInfo(@TypeOf(memory)).pointer;
        this.__scope.trackExternalFree(memory, null) catch |err|
            std.debug.panic("invalid free: {}", .{err});
    }
}

pub fn assertInScope(this: *AllocScope, memory: anytype) void {
    if (comptime bun.Environment.enableAllocScopes) {
        this.__scope.assertOwned(memory);
    }
}

pub inline fn allocator(this: *AllocScope) std.mem.Allocator {
    if (comptime bun.Environment.enableAllocScopes) {
        return this.__scope.allocator();
    }
    return bun.default_allocator;
}

const bun = @import("bun");
const std = @import("std");
