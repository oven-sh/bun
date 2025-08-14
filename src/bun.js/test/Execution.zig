executing: bool,
order: []*ExecutionEntry,
index: usize,

pub fn init(_: std.mem.Allocator) Execution {
    return .{
        .executing = false,
        .order = &.{},
        .index = 0,
    };
}
pub fn deinit(this: *Execution) void {
    this.bunTest().gpa.free(this.order);
}

fn bunTest(this: *Execution) *BunTest {
    group.begin(@src());
    defer group.end();

    return @fieldParentPtr("execution", this);
}

pub fn runOne(this: *Execution, globalThis: *jsc.JSGlobalObject) bun.JSError!describe2.RunOneResult {
    if (this.index >= this.order.len) return .done;
    const entry = this.order[this.index];
    this.index += 1;

    // if the callback is only called once, we can remove the strong reference to allow the gc to collect it.
    // TODO: at the end of a describe scope, we should be able to clean up any beforeEach/afterEach hooks. we can add this as a schedule entry with 'cleanup_describe' tag for example. it has to be at the end of the describe scope
    // because otherwise we might clean up a beforeEach hook that we still need if a test were to call test() within itself.
    const callback = if (entry.tag.isCalledMultipleTimes()) (entry.callback.get() orelse jsc.JSValue.zero) else entry.callback.swap();
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
    @panic("TODO testCallbackThen");
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
    // gather beforeAll
    for (current.beforeAll.items) |entry| {
        try order.append(entry);
    }

    for (current.entries.items) |entry| {
        try generateOrderSub(entry, order);
    }

    // gather afterAll
    for (current.afterAll.items) |entry| {
        try order.append(entry);
    }
}
pub fn generateOrderTest(current: *ExecutionEntry, order: *std.ArrayList(*ExecutionEntry)) bun.JSError!void {
    // gather beforeEach (alternatively, this could be implemented recursively to make it less complicated)
    {
        // determine length of beforeEach
        var beforeEachLen: usize = 0;
        {
            var parent: ?*DescribeScope = current.parent;
            while (parent) |p| : (parent = p.parent) {
                beforeEachLen += p.beforeEach.items.len;
            }
        }
        // copy beforeEach entries
        const beforeEachSlice = try order.addManyAsSlice(beforeEachLen);
        {
            var parent: ?*DescribeScope = current.parent;
            var i: usize = beforeEachLen;
            while (parent) |p| : (parent = p.parent) {
                i -= p.beforeEach.items.len;
                @memcpy(beforeEachSlice[i..][0..p.beforeEach.items.len], p.beforeEach.items);
            }
        }
    }

    // append test
    try order.append(current);

    // gather afterEach
    {
        var parent: ?*DescribeScope = current.parent;
        while (parent) |p| : (parent = p.parent) {
            for (p.afterEach.items) |entry| {
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
