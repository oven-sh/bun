//! An allocation scope is a debug
const AllocationScope = @This();
const enabled = @import("builtin").mode == .Debug;

parent_allocator: Allocator,

pub fn init(parent_allocator: Allocator) AllocationScope {
    return .{
        .parent_allocator = parent_allocator,
    };
}

const std = @import("std");
const Allocator = std.mem.Allocator;
