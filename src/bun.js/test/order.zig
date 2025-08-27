//! take Collection phase output and convert to Execution phase input

groups: std.ArrayList(ConcurrentGroup),
_sequences: std.ArrayList(ExecutionSequence),
_entries: std.ArrayList(*ExecutionEntry),

pub fn generateOrderSub(this: *Execution, current: TestScheduleEntry) bun.JSError!void {
    switch (current) {
        .describe => |describe| try generateOrderDescribe(this, describe),
        .test_callback => |test_callback| try generateOrderTest(this, test_callback),
    }
}
pub fn discardOrderSub(this: *Execution, current: TestScheduleEntry) bun.JSError!void {
    // TODO: here we can swap the callbacks with zero to allow them to be GC'd
    _ = this;
    _ = current;
}
pub fn generateAllOrder(this: *Execution, entries: []const *ExecutionEntry, cfg: struct { concurrent: bool }) bun.JSError!void {
    for (entries) |entry| {
        const entries_start = this._entries.items.len;
        try this._entries.append(entry); // add entry to sequence
        const entries_end = this._entries.items.len;
        const sequences_start = this._sequences.items.len;
        try this._sequences.append(.{ .entry_start = entries_start, .entry_end = entries_end, .entry_index = entries_start, .test_entry = null }); // add sequence to concurrentgroup
        const sequences_end = this._sequences.items.len;
        try appendOrExtendConcurrentGroup(this, cfg.concurrent, sequences_start, sequences_end); // add or extend the concurrent group
    }
}
pub fn generateOrderDescribe(this: *Execution, current: *DescribeScope) bun.JSError!void {
    if (current.failed) return; // do not schedule any tests in a failed describe scope

    // gather beforeAll
    try generateAllOrder(this, current.beforeAll.items, .{ .concurrent = current.base.concurrent });

    // gather children
    for (current.entries.items) |entry| {
        if (current.base.only == .contains and !entry.isOrContainsOnly()) {
            try discardOrderSub(this, entry);
            continue;
        }
        try generateOrderSub(this, entry);
    }

    // gather afterAll
    try generateAllOrder(this, current.afterAll.items, .{ .concurrent = current.base.concurrent });
}
pub fn generateOrderTest(this: *Execution, current: *ExecutionEntry) bun.JSError!void {
    const entries_start = this._entries.items.len;
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
        const beforeEachSlice = try this._entries.addManyAsSlice(beforeEachLen); // add entries to sequence
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
    try this._entries.append(current); // add entry to sequence

    // gather afterEach
    if (use_hooks) {
        var parent: ?*DescribeScope = current.base.parent;
        while (parent) |p| : (parent = p.base.parent) {
            try this._entries.appendSlice(p.afterEach.items); // add entry to sequence
        }
    }

    // add these as a single sequence
    const entries_end = this._entries.items.len;
    const sequences_start = this._sequences.items.len;
    try this._sequences.append(.{ .entry_start = entries_start, .entry_end = entries_end, .entry_index = entries_start, .test_entry = current }); // add sequence to concurrentgroup
    const sequences_end = this._sequences.items.len;
    try appendOrExtendConcurrentGroup(this, current.base.concurrent, sequences_start, sequences_end); // add or extend the concurrent group
}

pub fn appendOrExtendConcurrentGroup(this: *Execution, concurrent: bool, sequences_start: usize, sequences_end: usize) bun.JSError!void {
    if (concurrent and this.groups.items.len > 0) {
        const previous_group = &this.groups.items[this.groups.items.len - 1];
        if (previous_group.concurrent and previous_group.sequence_end == sequences_start) {
            previous_group.sequence_end = sequences_end; // extend the previous group to include this sequence
            return;
        }
    }
    try this.groups.append(.{ .sequence_start = sequences_start, .sequence_end = sequences_end, .concurrent = concurrent }); // otherwise, add a new concurrentgroup to order
}

const bun = @import("bun");

const describe2 = @import("./describe2.zig");
const DescribeScope = describe2.DescribeScope;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const TestScheduleEntry = describe2.TestScheduleEntry;
const ConcurrentGroup = describe2.Execution.ConcurrentGroup;
const ExecutionSequence = describe2.Execution.ExecutionSequence;
const std = @import("std");
