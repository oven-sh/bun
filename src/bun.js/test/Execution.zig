order: []*ExecutionEntry,
index: usize,
extra_queue: std.ArrayList(*ExecutionEntry), // for if test() is called inside a test. we will need to queue beforeEach/afterEach for these tests. this can be done by calling generateOrderSub on the TestScheduleEntry2 and passing extra_queue as the out parameter.

pub fn init(gpa: std.mem.Allocator) Execution {
    return .{
        .order = &.{},
        .index = 0,
        .extra_queue = .init(gpa),
    };
}
pub fn deinit(this: *Execution) void {
    this.extra_queue.deinit();
    this.bunTest().gpa.free(this.order);
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

pub fn generateOrderSub(current: TestScheduleEntry2, order: *std.ArrayList(*ExecutionEntry)) bun.JSError!void {
    switch (current) {
        .describe => |describe| {
            try generateOrderDescribe(describe, order);
        },
        .test_callback => |test_callback| {
            try generateOrderTest(test_callback, order);
        },
    }
}
pub fn generateOrderDescribe(current: *DescribeScope, order: *std.ArrayList(*ExecutionEntry)) bun.JSError!void {
    // gather beforeEach
    for (current.beforeEach.items) |entry| {
        // todo queue
        try order.append(entry);
    }

    for (current.entries.items) |entry| {
        try generateOrderSub(entry, order);
    }

    // gather afterEach
    for (current.afterEach.items) |entry| {
        try order.append(entry);
    }
}
pub fn generateOrderTest(current: *ExecutionEntry, order: *std.ArrayList(*ExecutionEntry)) bun.JSError!void {
    // gather beforeAll
    {
        // determine length of beforeAll
        var beforeAllLen: usize = 0;
        {
            var parent: ?*DescribeScope = current.parent;
            while (parent) |p| : (parent = p.parent) {
                beforeAllLen += p.beforeAll.items.len;
            }
        }
        // copy beforeAll entries
        const beforeAllSlice = try order.addManyAsSlice(beforeAllLen);
        {
            var parent: ?*DescribeScope = current.parent;
            var i: usize = beforeAllLen;
            while (parent) |p| : (parent = p.parent) {
                i -= p.beforeAll.items.len;
                @memcpy(beforeAllSlice[i..][0..p.beforeAll.items.len], p.beforeAll.items);
            }
        }
    }

    // append test
    try order.append(current);

    // gather afterAll
    {
        var parent: ?*DescribeScope = current.parent;
        while (parent) |p| : (parent = p.parent) {
            for (p.afterAll.items) |entry| {
                try order.append(entry);
            }
        }
    }
}

const std = @import("std");

const describe2 = @import("./describe2.zig");
const BunTest = describe2.BunTest;
const Collection = describe2.Collection;
const Execution = describe2.Execution;
const DescribeScope = describe2.DescribeScope;
const group = describe2.group;
const TestScope = describe2.TestScope;
const TestScheduleEntry2 = describe2.TestScheduleEntry2;
const ExecutionEntry = describe2.ExecutionEntry;

const bun = @import("bun");
const jsc = bun.jsc;
