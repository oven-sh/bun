order: []*TestScope,
index: usize,
extra_queue: std.ArrayList(*TestScope), // for if test() is called inside a test

pub fn init(gpa: std.mem.Allocator) Execution {
    return .{
        .order = &.{},
        .index = 0,
        .extra_queue = .init(gpa),
    };
}
pub fn deinit(this: *Execution) void {
    this.extra_queue.deinit();
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

pub fn generateOrderSub(current: *DescribeScope, out: *std.ArrayList(*TestScope)) bun.JSError!void {
    // gather beforeAll
    for (current.beforeEach.items) |entry| {
        // todo queue
        _ = entry;
        _ = out;
    }

    // add each test. before each test queue each beforeEach in this & parent scopes
    // after each test queue each afterEach in this & parent scopes

    // gather afterAll
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
