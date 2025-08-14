executing: bool,
order: []*ExecutionEntry,
index: usize,
extra_queue: std.ArrayList(*ExecutionEntry), // for if test() is called inside a test. we will need to queue beforeEach/afterEach for these tests. this can be done by calling generateOrderSub on the TestScheduleEntry2 and passing extra_queue as the out parameter.

pub fn init(gpa: std.mem.Allocator) Execution {
    return .{
        .executing = false,
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

pub fn runLoop(this: *Execution, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
    while (try this.runOne(globalThis) == .continue_sync) {}
}

pub fn runOne(this: *Execution, globalThis: *jsc.JSGlobalObject) bun.JSError!enum { done, continue_sync, continue_async } {
    if (this.extra_queue.items.len > 0) {
        @panic("TODO: implement extra_queue");
    }
    if (this.index >= this.order.len) return .done;
    const entry = this.order[this.index];
    this.index += 1;

    const callback = entry.callback.swap();
    if (callback == .zero) @panic("double-call of ExecutionEntry! TODO support beforeAll/afterAll which get called multiple times.");

    // TODO: catch errors
    const result = try callback.call(globalThis, .js_undefined, &.{});

    if (result.asPromise()) |_| {
        this.bunTest().addThen(globalThis, result);
        return .continue_async;
    }

    return .continue_sync;
}

pub fn testCallbackThen(this: *Execution, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
    _ = this;
    _ = globalThis;
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
