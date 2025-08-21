//! take Collection phase output and convert to Execution phase input

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
pub fn generateOrderDescribe(this: *Execution, current: *DescribeScope) bun.JSError!void {
    // gather beforeAll
    for (current.beforeAll.items) |entry| {
        const entries_start = this._entries.items.len;
        try this._entries.append(entry); // add entry to sequence
        const entries_end = this._entries.items.len;
        const sequences_start = this._sequences.items.len;
        try this._sequences.append(.{ .entry_start = entries_start, .entry_end = entries_end, .entry_index = entries_start, .test_entry = null }); // add sequence to concurrentgroup
        const sequences_end = this._sequences.items.len;
        try appendOrExtendConcurrentGroup(this, current.concurrent, sequences_start, sequences_end); // add or extend the concurrent group
    }

    for (current.entries.items) |entry| {
        if (current.only == .contains and !entry.isOrContainsOnly()) {
            try discardOrderSub(this, entry);
            continue;
        }
        try generateOrderSub(this, entry);
    }

    // gather afterAll (reverse order)
    var i: usize = current.afterAll.items.len;
    while (i > 0) {
        i -= 1;
        const entry = current.afterAll.items[i];

        const entries_start = this._entries.items.len;
        try this._entries.append(entry); // add entry to sequence
        const entries_end = this._entries.items.len;
        const sequences_start = this._sequences.items.len;
        try this._sequences.append(.{ .entry_start = entries_start, .entry_end = entries_end, .entry_index = entries_start, .test_entry = null }); // add sequence to concurrentgroup
        const sequences_end = this._sequences.items.len;
        try appendOrExtendConcurrentGroup(this, current.concurrent, sequences_start, sequences_end); // add or extend the concurrent group
    }
}
pub fn generateOrderTest(this: *Execution, current: *ExecutionEntry) bun.JSError!void {
    const entries_start = this._entries.items.len;
    const use_hooks = current.callback.get() != null;

    // gather beforeEach (alternatively, this could be implemented recursively to make it less complicated)
    if (use_hooks) {
        // determine length of beforeEach
        var beforeEachLen: usize = 0;
        {
            var parent: ?*DescribeScope = current.parent;
            while (parent) |p| : (parent = p.parent) {
                beforeEachLen += p.beforeEach.items.len;
            }
        }
        // copy beforeEach entries
        const beforeEachSlice = try this._entries.addManyAsSlice(beforeEachLen); // add entries to sequence
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
    try this._entries.append(current); // add entry to sequence

    // gather afterEach
    if (use_hooks) {
        var parent: ?*DescribeScope = current.parent;
        while (parent) |p| : (parent = p.parent) {
            var i: usize = p.afterEach.items.len;
            while (i > 0) {
                i -= 1;
                const entry = p.afterEach.items[i];
                try this._entries.append(entry); // add entry to sequence
            }
        }
    }

    // add these as a single sequence
    const entries_end = this._entries.items.len;
    const sequences_start = this._sequences.items.len;
    try this._sequences.append(.{ .entry_start = entries_start, .entry_end = entries_end, .entry_index = entries_start, .test_entry = current }); // add sequence to concurrentgroup
    const sequences_end = this._sequences.items.len;
    try appendOrExtendConcurrentGroup(this, current.concurrent, sequences_start, sequences_end); // add or extend the concurrent group
}

pub fn appendOrExtendConcurrentGroup(this: *Execution, concurrent: bool, sequences_start: usize, sequences_end: usize) bun.JSError!void {
    if (concurrent and this.order.items.len > 0) {
        const previous_group = &this.order.items[this.order.items.len - 1];
        if (previous_group.concurrent and previous_group.sequence_end == sequences_start) {
            previous_group.sequence_end = sequences_end; // extend the previous group to include this sequence
            return;
        }
    }
    try this.order.append(.{ .sequence_start = sequences_start, .sequence_end = sequences_end, .concurrent = concurrent }); // otherwise, add a new concurrentgroup to order
}

const bun = @import("bun");

const describe2 = @import("./describe2.zig");
const DescribeScope = describe2.DescribeScope;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const TestScheduleEntry = describe2.TestScheduleEntry;
