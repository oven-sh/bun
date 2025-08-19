const Self = @This();

_scope: if (AllocationScope.enabled) AllocationScope else void,

pub fn init(alloc_scope: AllocationScope) Self {
    return .{ ._scope = if (comptime AllocationScope.enabled) alloc_scope };
}

pub fn get(self: Self) Allocator {
    return if (comptime AllocationScope.enabled) self._scope.allocator() else bun.default_allocator;
}

pub fn scope(self: Self) ?AllocationScope {
    return if (comptime AllocationScope.enabled) self._scope else null;
}

const bun = @import("bun");
const std = @import("std");
const AllocationScope = bun.allocators.AllocationScope;
const Allocator = std.mem.Allocator;
