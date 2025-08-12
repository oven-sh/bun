pub fn init(_: std.mem.Allocator) Execution {
    return .{};
}

const std = @import("std");

const describe2 = @import("./describe2.zig");
const Execution = describe2.Execution;
