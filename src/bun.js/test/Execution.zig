order: []*TestScope,
index: usize,
extra_queue: std.ArrayList(*TestScope), // for if test() is called inside a test

pub fn init(_: std.mem.Allocator) Execution {
    return .{};
}

fn bunTest(this: *Execution) *BunTest {
    group.begin(@src());
    defer group.end();

    return @fieldParentPtr("execution", this);
}

pub fn runLoop(this: *Execution) bun.JSError!void {
    while (this.index < this.order.len) |current| {
        switch (this.runOne(current)) {
            .async_ => return,
            .sync => {
                this.index += 1;
            },
        }
    }
}

pub fn runOne(this: *Execution, current: *DescribeScope) bun.JSError!enum { sync, async_ } {
    _ = this;
    _ = current;
}

const std = @import("std");

const describe2 = @import("./describe2.zig");
const BunTest = describe2.BunTest;
const Collection = describe2.Collection;
const Execution = describe2.Execution;
const DescribeScope = describe2.DescribeScope;
const group = describe2.group;
const TestScope = describe2.TestScope;

const bun = @import("bun");
const jsc = bun.jsc;
