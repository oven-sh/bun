pub fn init(_: std.mem.Allocator) Execution {
    return .{};
}

fn bunTest(this: *Execution) *BunTest {
    group.begin(@src());
    defer group.end();

    return @fieldParentPtr("execution", this);
}

pub fn runLoop() bun.JSError!void {
    while (true) {
        // run the next test or hook
    }
}

const std = @import("std");

const describe2 = @import("./describe2.zig");
const BunTest = describe2.BunTest;
const Collection = describe2.Collection;
const Execution = describe2.Execution;
const DescribeScope = describe2.DescribeScope;
const group = describe2.group;

const bun = @import("bun");
const jsc = bun.jsc;
