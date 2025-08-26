const Self = @This();

maybe_scope: if (AllocationScope.enabled) AllocationScope else void,

pub fn get(self: Self) Allocator {
    return if (comptime AllocationScope.enabled)
        self.maybe_scope.allocator()
    else
        bun.default_allocator;
}

pub fn scope(self: Self) ?AllocationScope {
    return if (comptime AllocationScope.enabled) self.maybe_scope else null;
}

const bun = @import("bun");
const std = @import("std");
const AllocationScope = bun.allocators.AllocationScope;
const Allocator = std.mem.Allocator;
