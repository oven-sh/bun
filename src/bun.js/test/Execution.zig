order: std.ArrayList(ConcurrentGroup),
_sequences: std.ArrayList(ExecutionSequence),
_entries: std.ArrayList(*ExecutionEntry),
order_index: usize,

const ConcurrentGroup = struct {
    sequence_start: usize,
    sequence_end: usize,
    executing: bool = false,
};
const ExecutionSequence = struct {
    entry_start: usize,
    entry_end: usize,
    entry_index: usize,
    remaining_repeat_count: f64 = 1,
    result: jsc.Jest.Result = .pending,
    executing: bool = false,
};

pub fn init(gpa: std.mem.Allocator) Execution {
    return .{
        .order = std.ArrayList(ConcurrentGroup).init(gpa),
        ._sequences = std.ArrayList(ExecutionSequence).init(gpa),
        ._entries = std.ArrayList(*ExecutionEntry).init(gpa),
        .order_index = 0,
    };
}
pub fn deinit(this: *Execution) void {
    this.order.deinit();
    this._sequences.deinit();
    this._entries.deinit();
}

fn bunTest(this: *Execution) *BunTest {
    return @fieldParentPtr("execution", this);
}

pub fn runOne(this: *Execution, _: *jsc.JSGlobalObject, callback_queue: *describe2.CallbackQueue) bun.JSError!describe2.RunOneResult {
    groupLog.begin(@src());
    defer groupLog.end();

    if (this.order_index >= this.order.items.len) return .done;

    this.order.items[this.order_index].executing = true;

    // loop over items in the group and advance their execution
    const group = &this.order.items[this.order_index];
    if (!group.executing) this.resetGroup(this.order_index);
    var status: describe2.RunOneResult = .done;
    for (group.sequence_start..group.sequence_end) |sequence_index| {
        switch (try this.runSequence(sequence_index, callback_queue)) {
            .done => {},
            .execute => status = .execute,
        }
    }

    if (status == .done) {
        this.order_index += 1;
    }
    return .execute;
}
pub fn runOneCompleted(this: *Execution, _: *jsc.JSGlobalObject, result_is_error: bool, result_value: jsc.JSValue) bun.JSError!void {
    groupLog.begin(@src());
    defer groupLog.end();

    if (result_is_error) {
        _ = result_value;
        groupLog.log("TODO: print error", .{});
    }

    bun.assert(this.order_index < this.order.items.len);
    const group = &this.order.items[this.order_index];

    if (group.sequence_start + 1 != group.sequence_end) {
        @panic("TODO support concurrent groups (requires passing additional data to completed callback)");
    }
    const sequence = &this._sequences.items[group.sequence_start];
    bun.assert(sequence.entry_index < sequence.entry_end);
    sequence.executing = false;
    sequence.entry_index += 1;
    if (result_is_error) {
        sequence.result = .{ .fail = 0 };
        // TODO: if this is a beforeAll, maybe we skip running the test?
        groupLog.log("TODO: log error", .{});
    } else if (sequence.result == .pending) {
        sequence.result = .{ .pass = 0 };
    }

    groupLog.log("TODO: announce test result", .{});
}
pub fn resetGroup(this: *Execution, group_index: usize) void {
    groupLog.begin(@src());
    defer groupLog.end();

    const group = this.order.items[group_index];
    bun.assert(!group.executing);
    for (group.sequence_start..group.sequence_end) |sequence_index| {
        this.resetSequence(sequence_index);
    }
}
pub fn resetSequence(this: *Execution, sequence_index: usize) void {
    const sequence = &this._sequences.items[sequence_index];
    bun.assert(!sequence.executing);
    if (sequence.result == .pass or sequence.result == .pending) {
        // passed or pending; run again
        sequence.entry_index = sequence.entry_start;
        sequence.result = .pending;
    } else {
        // already failed or skipped; don't run
        sequence.entry_index = sequence.entry_end;
    }
}
pub fn runSequence(this: *Execution, sequence_index: usize, callback_queue: *describe2.CallbackQueue) bun.JSError!describe2.RunOneResult {
    groupLog.begin(@src());
    defer groupLog.end();

    const sequence = &this._sequences.items[sequence_index];
    if (sequence.executing) return .done; // can't advance; already executing
    if (sequence.entry_index >= sequence.entry_end) {
        sequence.remaining_repeat_count -= 1;
        if (sequence.remaining_repeat_count <= 0) return .done;
        this.resetSequence(sequence_index);
    }

    const next_item = this._entries.items[sequence.entry_index];
    sequence.executing = true;
    try callback_queue.append(.{ .callback = .init(this.bunTest().gpa, next_item.callback.get()), .done_parameter = true });
    return .execute;
}

pub fn generateOrderSub(this: *Execution, current: TestScheduleEntry) bun.JSError!void {
    switch (current) {
        .describe => |describe| {
            try this.generateOrderDescribe(describe);
        },
        .test_callback => |test_callback| {
            try this.generateOrderTest(test_callback);
        },
    }
}
pub fn generateOrderDescribe(this: *Execution, current: *DescribeScope) bun.JSError!void {
    // gather beforeAll
    for (current.beforeAll.items) |entry| {
        const entries_start = this._entries.items.len;
        try this._entries.append(entry); // add entry to sequence
        const entries_end = this._entries.items.len;
        const sequences_start = this._sequences.items.len;
        try this._sequences.append(.{ .entry_start = entries_start, .entry_end = entries_end, .entry_index = entries_start }); // add sequence to concurrentgroup
        const sequences_end = this._sequences.items.len;
        try this.order.append(.{ .sequence_start = sequences_start, .sequence_end = sequences_end }); // add concurrentgroup to order
    }

    for (current.entries.items) |entry| {
        try this.generateOrderSub(entry);
    }

    // gather afterAll
    for (current.afterAll.items) |entry| {
        const entries_start = this._entries.items.len;
        try this._entries.append(entry); // add entry to sequence
        const entries_end = this._entries.items.len;
        const sequences_start = this._sequences.items.len;
        try this._sequences.append(.{ .entry_start = entries_start, .entry_end = entries_end, .entry_index = entries_start }); // add sequence to concurrentgroup
        const sequences_end = this._sequences.items.len;
        try this.order.append(.{ .sequence_start = sequences_start, .sequence_end = sequences_end }); // add concurrentgroup to order
    }
}
pub fn generateOrderTest(this: *Execution, current: *ExecutionEntry) bun.JSError!void {
    const entries_start = this._entries.items.len;

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
    {
        var parent: ?*DescribeScope = current.parent;
        while (parent) |p| : (parent = p.parent) {
            for (p.afterEach.items) |entry| {
                try this._entries.append(entry); // add entry to sequence
            }
        }
    }

    // add these as a single sequence
    const entries_end = this._entries.items.len;
    const sequences_start = this._sequences.items.len;
    try this._sequences.append(.{ .entry_start = entries_start, .entry_end = entries_end, .entry_index = entries_start }); // add sequence to concurrentgroup
    const sequences_end = this._sequences.items.len;
    try this.order.append(.{ .sequence_start = sequences_start, .sequence_end = sequences_end }); // add concurrentgroup to order
}

pub fn dumpSub(globalThis: *jsc.JSGlobalObject, current: TestScheduleEntry) bun.JSError!void {
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    switch (current) {
        .describe => |describe| try dumpDescribe(globalThis, describe),
        .test_callback => |test_callback| try dumpTest(globalThis, test_callback),
    }
}
pub fn dumpDescribe(globalThis: *jsc.JSGlobalObject, describe: *DescribeScope) bun.JSError!void {
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    groupLog.beginMsg("describe {s}", .{(describe.name.get() orelse jsc.JSValue.js_undefined).toFmt(&formatter)});
    defer groupLog.end();

    for (describe.entries.items) |entry| {
        try dumpSub(globalThis, entry);
    }
}
pub fn dumpTest(globalThis: *jsc.JSGlobalObject, current: *ExecutionEntry) bun.JSError!void {
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    groupLog.beginMsg("test {s} / {s}", .{ @tagName(current.tag), (current.name.get() orelse jsc.JSValue.js_undefined).toFmt(&formatter) });
    defer groupLog.end();
}
pub fn dumpOrder(this: *Execution, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
    groupLog.beginMsg("dumpOrder", .{});
    defer groupLog.end();

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    for (this.order.items, 0..) |group, group_index| {
        groupLog.beginMsg("{d}: ConcurrentGroup {d}-{d}", .{ group_index, group.sequence_start, group.sequence_end });
        defer groupLog.end();

        for (group.sequence_start..group.sequence_end) |sequence_index| {
            const sequence = &this._sequences.items[sequence_index];
            groupLog.beginMsg("{d}: Sequence {d}-{d}", .{ sequence_index, sequence.entry_start, sequence.entry_end });
            defer groupLog.end();

            for (sequence.entry_start..sequence.entry_end) |entry_index| {
                const entry = this._entries.items[entry_index];
                groupLog.log("{d}: ExecutionEntry {d}: {s} / {}", .{ entry_index, entry_index, @tagName(entry.tag), (entry.name.get() orelse jsc.JSValue.js_undefined).toFmt(&formatter) });
            }
        }
    }
}

const std = @import("std");

const describe2 = @import("./describe2.zig");
const BunTest = describe2.BunTest;
const Execution = describe2.Execution;
const DescribeScope = describe2.DescribeScope;
const groupLog = describe2.group;
const TestScope = describe2.TestScope;
const TestScheduleEntry = describe2.TestScheduleEntry;
const ExecutionEntry = describe2.ExecutionEntry;
const ExecutionEntryTag = describe2.ExecutionEntryTag;

const bun = @import("bun");
const jsc = bun.jsc;
