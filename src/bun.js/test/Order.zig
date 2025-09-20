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

pub fn generateOrderSub(this: *Order, current: TestScheduleEntry, cfg: Config) bun.JSError!void {
    switch (current) {
        .describe => |describe| try generateOrderDescribe(this, describe, cfg),
        .test_callback => |test_callback| try generateOrderTest(this, test_callback, cfg),
    }
}
pub const AllOrderResult = struct {
    start: usize,
    end: usize,
    pub const empty: AllOrderResult = .{ .start = 0, .end = 0 };
    pub fn setFailureSkipTo(aor: AllOrderResult, this: *Order) void {
        if (aor.start == 0 and aor.end == 0) return;
        const skip_to = this.groups.items.len;
        for (this.groups.items[aor.start..aor.end]) |*group| {
            group.failure_skip_to = skip_to;
        }
    }
};
pub const Config = struct {
    always_use_hooks: bool = false,
};
pub fn generateAllOrder(this: *Order, entries: []const *ExecutionEntry, _: Config) bun.JSError!AllOrderResult {
    const start = this.groups.items.len;
    for (entries) |entry| {
        const entries_start = this.entries.items.len;
        try this.entries.append(entry); // add entry to sequence
        const entries_end = this.entries.items.len;
        const sequences_start = this.sequences.items.len;
        try this.sequences.append(.init(entries_start, entries_end, null)); // add sequence to concurrentgroup
        const sequences_end = this.sequences.items.len;
        try this.groups.append(.init(sequences_start, sequences_end, this.groups.items.len + 1)); // add a new concurrentgroup to order
        this.previous_group_was_concurrent = false;
    }
    const end = this.groups.items.len;
    return .{ .start = start, .end = end };
}
pub fn generateOrderDescribe(this: *Order, current: *DescribeScope, cfg: Config) bun.JSError!void {
    if (current.failed) return; // do not schedule any tests in a failed describe scope
    const use_hooks = cfg.always_use_hooks or current.base.has_callback;

    // gather beforeAll
    const beforeall_order: AllOrderResult = if (use_hooks) try generateAllOrder(this, current.beforeAll.items, cfg) else .empty;

    // gather children
    for (current.entries.items) |entry| {
        if (current.base.only == .contains and entry.base().only == .no) continue;
        try generateOrderSub(this, entry, cfg);
    }

    // update skip_to values for beforeAll to skip to the first afterAll
    beforeall_order.setFailureSkipTo(this);

    // gather afterAll
    const afterall_order: AllOrderResult = if (use_hooks) try generateAllOrder(this, current.afterAll.items, cfg) else .empty;

    // update skip_to values for afterAll to skip the remaining afterAll items
    afterall_order.setFailureSkipTo(this);
}
pub fn generateOrderTest(this: *Order, current: *ExecutionEntry, _: Config) bun.JSError!void {
    const entries_start = this.entries.items.len;
    bun.assert(current.base.has_callback == (current.callback != null));
    const use_each_hooks = current.base.has_callback;

    // gather beforeEach (alternatively, this could be implemented recursively to make it less complicated)
    if (use_each_hooks) {
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
    if (use_each_hooks) {
        var parent: ?*DescribeScope = current.base.parent;
        while (parent) |p| : (parent = p.base.parent) {
            try this.entries.appendSlice(p.afterEach.items); // add entry to sequence
        }
    }

    // add these as a single sequence
    const entries_end = this.entries.items.len;
    const sequences_start = this.sequences.items.len;
    try this.sequences.append(.init(entries_start, entries_end, current)); // add sequence to concurrentgroup
    const sequences_end = this.sequences.items.len;
    try appendOrExtendConcurrentGroup(this, current.base.concurrent, sequences_start, sequences_end); // add or extend the concurrent group
}

pub fn appendOrExtendConcurrentGroup(this: *Order, concurrent: bool, sequences_start: usize, sequences_end: usize) bun.JSError!void {
    defer this.previous_group_was_concurrent = concurrent;
    if (concurrent and this.groups.items.len > 0) {
        const previous_group = &this.groups.items[this.groups.items.len - 1];
        if (this.previous_group_was_concurrent) {
            // extend the previous group to include this sequence
            if (previous_group.tryExtend(sequences_start, sequences_end)) return;
        }
    }
    try this.groups.append(.init(sequences_start, sequences_end, this.groups.items.len + 1)); // otherwise, add a new concurrentgroup to order
}

const bun = @import("bun");
const std = @import("std");

const bun_test = bun.jsc.Jest.bun_test;
const DescribeScope = bun_test.DescribeScope;
const ExecutionEntry = bun_test.ExecutionEntry;
const Order = bun_test.Order;
const TestScheduleEntry = bun_test.TestScheduleEntry;

const Execution = bun_test.Execution;
const ConcurrentGroup = bun_test.Execution.ConcurrentGroup;
const ExecutionSequence = bun_test.Execution.ExecutionSequence;
