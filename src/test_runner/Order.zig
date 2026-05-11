//! take Collection phase output and convert to Execution phase input

groups: std.array_list.Managed(ConcurrentGroup),
sequences: std.array_list.Managed(ExecutionSequence),
arena: std.mem.Allocator,
previous_group_was_concurrent: bool = false,
cfg: Config,

pub fn init(gpa: std.mem.Allocator, arena: std.mem.Allocator, cfg: Config) Order {
    return .{
        .groups = std.array_list.Managed(ConcurrentGroup).init(gpa),
        .sequences = std.array_list.Managed(ExecutionSequence).init(gpa),
        .cfg = cfg,
        .arena = arena,
    };
}
pub fn deinit(this: *Order) void {
    this.groups.deinit();
    this.sequences.deinit();
}

pub fn generateOrderSub(this: *Order, current: TestScheduleEntry) bun.JSError!void {
    switch (current) {
        .describe => |describe| try generateOrderDescribe(this, describe),
        .test_callback => |test_callback| try generateOrderTest(this, test_callback),
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
    always_use_hooks: bool,
    randomize: ?std.Random,
};
pub fn generateAllOrder(this: *Order, entries: []const *ExecutionEntry) bun.JSError!AllOrderResult {
    const start = this.groups.items.len;
    for (entries) |entry| {
        if (bun.Environment.ci_assert and entry.added_in_phase != .preload) bun.assert(entry.next == null);
        entry.next = null;
        entry.failure_skip_past = null;
        const sequences_start = this.sequences.items.len;
        try this.sequences.append(.init(.{
            .first_entry = entry,
            .test_entry = null,
        })); // add sequence to concurrentgroup
        const sequences_end = this.sequences.items.len;
        try this.groups.append(.init(sequences_start, sequences_end, this.groups.items.len + 1)); // add a new concurrentgroup to order
        this.previous_group_was_concurrent = false;
    }
    const end = this.groups.items.len;
    return .{ .start = start, .end = end };
}
pub fn generateOrderDescribe(this: *Order, current: *DescribeScope) bun.JSError!void {
    if (current.failed) return; // do not schedule any tests in a failed describe scope
    const use_hooks = this.cfg.always_use_hooks or current.base.has_callback;

    // gather beforeAll
    const beforeall_order: AllOrderResult = if (use_hooks) try generateAllOrder(this, current.beforeAll.items) else .empty;

    // shuffle entries if randomize flag is set
    if (this.cfg.randomize) |random| {
        random.shuffle(TestScheduleEntry, current.entries.items);
    }

    // gather children
    for (current.entries.items) |entry| {
        if (current.base.only == .contains and entry.base().only == .no) continue;
        try generateOrderSub(this, entry);
    }

    // update skip_to values for beforeAll to skip to the first afterAll
    beforeall_order.setFailureSkipTo(this);

    // gather afterAll
    const afterall_order: AllOrderResult = if (use_hooks) try generateAllOrder(this, current.afterAll.items) else .empty;

    // update skip_to values for afterAll to skip the remaining afterAll items
    afterall_order.setFailureSkipTo(this);
}

const EntryList = struct {
    first: ?*ExecutionEntry = null,
    last: ?*ExecutionEntry = null,
    pub fn prepend(this: *EntryList, current: *ExecutionEntry) void {
        current.next = this.first;
        this.first = current;
        if (this.last == null) this.last = current;
    }
    pub fn append(this: *EntryList, current: *ExecutionEntry) void {
        if (bun.Environment.ci_assert and current.added_in_phase != .preload) bun.assert(current.next == null);
        current.next = null;
        if (this.last) |last| {
            if (bun.Environment.ci_assert and last.added_in_phase != .preload) bun.assert(last.next == null);
            last.next = current;
            this.last = current;
        } else {
            this.first = current;
            this.last = current;
        }
    }
};

pub fn generateOrderTest(this: *Order, current: *ExecutionEntry) bun.JSError!void {
    bun.assert(current.base.has_callback == (current.callback != null));
    const use_each_hooks = current.base.has_callback;

    var list: EntryList = .{};

    // gather beforeEach (alternatively, this could be implemented recursively to make it less complicated)
    if (use_each_hooks) {
        var parent: ?*DescribeScope = current.base.parent;
        while (parent) |p| : (parent = p.base.parent) {
            // prepend in reverse so they end up in forwards order
            var i: usize = p.beforeEach.items.len;
            while (i > 0) : (i -= 1) {
                list.prepend(bun.create(this.arena, ExecutionEntry, p.beforeEach.items[i - 1].*));
            }
        }
    }

    // append test
    list.append(current); // add entry to sequence

    // gather afterEach
    if (use_each_hooks) {
        var parent: ?*DescribeScope = current.base.parent;
        while (parent) |p| : (parent = p.base.parent) {
            for (p.afterEach.items) |entry| {
                list.append(bun.create(this.arena, ExecutionEntry, entry.*));
            }
        }
    }

    // set skip_to values
    var index = list.first;
    var failure_skip_past: ?*ExecutionEntry = current;
    while (index) |entry| : (index = entry.next) {
        entry.failure_skip_past = failure_skip_past; // we could consider matching skip_to in beforeAll to skip directly to the first afterAll from its own scope rather than skipping to the first afterAll from any scope
        if (entry == failure_skip_past) failure_skip_past = null;
    }

    // add these as a single sequence
    const sequences_start = this.sequences.items.len;
    try this.sequences.append(.init(.{
        .first_entry = list.first,
        .test_entry = current,
        .retry_count = current.retry_count,
        .repeat_count = current.repeat_count,
    })); // add sequence to concurrentgroup
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
