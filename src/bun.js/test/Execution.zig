pub fn init(_: std.mem.Allocator) Execution {
    return .{};
}

const bun = @import("bun");
const jsc = bun.jsc;
const std = @import("std");
const describe2 = @import("describe2.zig");
const DescribeScope = describe2.DescribeScope;
const Execution = describe2.TestExecution;
const group = describe2.group;
