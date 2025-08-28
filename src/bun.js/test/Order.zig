//! take Collection phase output and convert to Execution phase input

groups: std.ArrayList(ConcurrentGroup),
sequences: std.ArrayList(ExecutionSequence),
entries: std.ArrayList(*ExecutionEntry),
previous_group_was_concurrent: bool = false,

pub fn init(gpa: std.mem.Allocator) Order {
    return .{
        .groups = std.ArrayList(ConcurrentGroup).init(gpa),
        .sequences = std.ArrayList(ExecutionSequence).init(gpa),
        .entries = std.ArrayList(*ExecutionEntry).init(gpa),
    };
}
pub fn deinit(this: *Order) void {
    this.groups.deinit();
    this.sequences.deinit();
    this.entries.deinit();
}

pub fn generateOrderSub(this: *Order, current: TestScheduleEntry) bun.JSError!void {
    switch (current) {
        .describe => |describe| try generateOrderDescribe(this, describe),
        .test_callback => |test_callback| try generateOrderTest(this, test_callback),
    }
}
pub fn generateAllOrder(this: *Order, entries: []const *ExecutionEntry) bun.JSError!void {
    for (entries) |entry| {
        const entries_start = this.entries.items.len;
        try this.entries.append(entry); // add entry to sequence
        const entries_end = this.entries.items.len;
        const sequences_start = this.sequences.items.len;
        try this.sequences.append(.{ .@"#entries_start" = entries_start, .@"#entries_end" = entries_end, .index = 0, .test_entry = null }); // add sequence to concurrentgroup
        const sequences_end = this.sequences.items.len;
        try appendOrExtendConcurrentGroup(this, false, sequences_start, sequences_end); // add a new concurrent group. note that beforeAll/afterAll are never concurrent.
    }
}
pub fn generateOrderDescribe(this: *Order, current: *DescribeScope) bun.JSError!void {
    if (current.failed) return; // do not schedule any tests in a failed describe scope

    // TODO: do not gather beforeAll and afterAll if no sub-tests have a callback
    // this will work for filter, skip, and todo

    // gather beforeAll
    try generateAllOrder(this, current.beforeAll.items);

    // gather children
    for (current.entries.items) |entry| {
        if (current.base.only == .contains and entry.base().only == .no) continue;
        try generateOrderSub(this, entry);
    }

    // gather afterAll
    try generateAllOrder(this, current.afterAll.items);
}
pub fn generateOrderTest(this: *Order, current: *ExecutionEntry) bun.JSError!void {
    const entries_start = this.entries.items.len;
    const use_hooks = current.callback != null;

    // gather beforeEach (alternatively, this could be implemented recursively to make it less complicated)
    if (use_hooks) {
        // determine length of beforeEach
        var beforeEachLen: usize = 0;
        {
            var parent: ?*DescribeScope = current.base.parent;
            while (parent) |p| : (parent = p.base.parent) {
                beforeEachLen += p.beforeEach.items.len;
            }
        }
        // copy beforeEach entries
        const beforeEachSlice = try this.entries.addManyAsSlice(beforeEachLen); // add entries to sequence
        {
            var parent: ?*DescribeScope = current.base.parent;
            var i: usize = beforeEachLen;
            while (parent) |p| : (parent = p.base.parent) {
                i -= p.beforeEach.items.len;
                @memcpy(beforeEachSlice[i..][0..p.beforeEach.items.len], p.beforeEach.items);
            }
        }
    }

    // append test
    try this.entries.append(current); // add entry to sequence

    // gather afterEach
    if (use_hooks) {
        var parent: ?*DescribeScope = current.base.parent;
        while (parent) |p| : (parent = p.base.parent) {
            try this.entries.appendSlice(p.afterEach.items); // add entry to sequence
        }
    }

    // add these as a single sequence
    const entries_end = this.entries.items.len;
    const sequences_start = this.sequences.items.len;
    try this.sequences.append(.{ .@"#entries_start" = entries_start, .@"#entries_end" = entries_end, .index = 0, .test_entry = current }); // add sequence to concurrentgroup
    const sequences_end = this.sequences.items.len;
    try appendOrExtendConcurrentGroup(this, current.base.concurrent, sequences_start, sequences_end); // add or extend the concurrent group
}

pub fn appendOrExtendConcurrentGroup(this: *Order, concurrent: bool, sequences_start: usize, sequences_end: usize) bun.JSError!void {
    defer this.previous_group_was_concurrent = concurrent;
    if (concurrent and this.groups.items.len > 0) {
        const previous_group = &this.groups.items[this.groups.items.len - 1];
        if (this.previous_group_was_concurrent and previous_group.@"#sequence_end" == sequences_start) {
            previous_group.@"#sequence_end" = sequences_end; // extend the previous group to include this sequence
            return;
        }
    }
    try this.groups.append(.{ .@"#sequence_start" = sequences_start, .@"#sequence_end" = sequences_end }); // otherwise, add a new concurrentgroup to order
}

const bun = @import("bun");

const describe2 = @import("./describe2.zig");
const DescribeScope = describe2.DescribeScope;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const TestScheduleEntry = describe2.TestScheduleEntry;
const ConcurrentGroup = describe2.Execution.ConcurrentGroup;
const ExecutionSequence = describe2.Execution.ExecutionSequence;
const Order = describe2.Order;
const std = @import("std");
