order: std.ArrayList(ConcurrentGroup),
_sequences: std.ArrayList(ExecutionSequence),
_entries: std.ArrayList(*ExecutionEntry),
order_index: usize,

const ConcurrentGroup = struct {
    sequence_start: usize,
    sequence_end: usize,
    executing: bool = false,
    concurrent: bool,
};
pub const ExecutionSequence = struct {
    entry_start: usize,
    entry_end: usize,
    entry_index: usize,
    test_entry: ?*ExecutionEntry,
    remaining_repeat_count: f64 = 1,
    result: Result = .pending,
    executing: bool = false,
    started_at: bun.timespec = bun.timespec.epoch,
    expect_call_count: u32 = 0, // TODO: impl incrementExpectCallCounter to increment this number and others
};
pub const Result = enum {
    pending,
    pass,
    fail,
    skip,
    todo,
    timeout,
    skipped_because_label,
    fail_because_failing_test_passed,
    fail_because_todo_passed,
    fail_because_expected_has_assertions,
    fail_because_expected_assertion_count,

    fn isPass(this: Result) bool {
        return switch (this) {
            .pass, .skip, .todo, .skipped_because_label => true,
            .fail, .timeout, .fail_because_failing_test_passed, .fail_because_todo_passed, .fail_because_expected_has_assertions, .fail_because_expected_assertion_count => false,
            .pending => false,
        };
    }
};
const EntryID = enum(usize) {
    none = std.math.maxInt(usize),
    _,
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

    while (true) {
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

        if (status == .execute) return .execute;
        this.order_index += 1;
    }
}
pub fn runOneCompleted(this: *Execution, _: *jsc.JSGlobalObject, result_is_error: bool, result_value: jsc.JSValue, data: u64) bun.JSError!void {
    groupLog.begin(@src());
    defer groupLog.end();

    const sequence_index: usize = @intCast(data);
    groupLog.log("runOneCompleted sequence_index {d}", .{sequence_index});

    if (result_is_error) {
        _ = result_value;
        groupLog.log("TODO: print error", .{});
    }

    bun.assert(this.order_index < this.order.items.len);
    const group = &this.order.items[this.order_index];

    if (sequence_index < group.sequence_start or sequence_index >= group.sequence_end) {
        bun.debugAssert(false);
        return;
    }
    const sequence = &this._sequences.items[sequence_index];
    bun.assert(sequence.entry_index < sequence.entry_end);

    sequence.executing = false;
    sequence.entry_index += 1;
    if (result_is_error) {
        sequence.result = .fail;
        // TODO: if this is a beforeAll, maybe we skip running the test?
        groupLog.log("TODO: log error", .{});
    } else if (sequence.result == .pending) {
        sequence.result = .pass;
    }
}
fn onSequenceStarted(this: *Execution, sequence_index: usize) void {
    const sequence = &this._sequences.items[sequence_index];
    sequence.started_at = bun.timespec.now();
}
fn onSequenceCompleted(this: *Execution, sequence_index: usize) void {
    const sequence = &this._sequences.items[sequence_index];
    const elapsed_ns = sequence.started_at.sinceNow();
    test_command.CommandLineReporter.handleTestPass(this.bunTest(), sequence, sequence.test_entry orelse return, elapsed_ns);
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
    if (sequence.result.isPass()) {
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
    if (sequence.executing) return .execute; // can't advance; already executing
    if (sequence.entry_index >= sequence.entry_end) {
        this.onSequenceCompleted(sequence_index);
        sequence.remaining_repeat_count -= 1;
        if (sequence.remaining_repeat_count <= 0) return .done; // done
        this.resetSequence(sequence_index);
    }

    const next_item = this._entries.items[sequence.entry_index];
    sequence.executing = true;
    this.onSequenceStarted(sequence_index);

    groupLog.log("runSequence queued callback for sequence_index {d} (entry_index {d})", .{ sequence_index, sequence.entry_index });
    try callback_queue.append(.{ .callback = .init(this.bunTest().gpa, next_item.callback.get()), .done_parameter = true, .data = sequence_index });
    return .execute; // execute
}

pub fn generateOrderSub(this: *Execution, current: TestScheduleEntry) bun.JSError!void {
    switch (current) {
        .describe => |describe| try this.generateOrderDescribe(describe),
        .test_callback => |test_callback| try this.generateOrderTest(test_callback),
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
        try this.appendOrExtendConcurrentGroup(current.concurrent, sequences_start, sequences_end); // add or extend the concurrent group
    }

    for (current.entries.items) |entry| {
        if (current.only == .contains and !entry.isOrContainsOnly()) {
            try this.discardOrderSub(entry);
            continue;
        }
        try this.generateOrderSub(entry);
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
        try this.appendOrExtendConcurrentGroup(current.concurrent, sequences_start, sequences_end); // add or extend the concurrent group
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
    try this._sequences.append(.{ .entry_start = entries_start, .entry_end = entries_end, .entry_index = entries_start, .test_entry = current }); // add sequence to concurrentgroup
    const sequences_end = this._sequences.items.len;
    try this.appendOrExtendConcurrentGroup(current.concurrent, sequences_start, sequences_end); // add or extend the concurrent group
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

    groupLog.beginMsg("describe {s} (concurrent={}, filter={s}, only={s})", .{ (describe.name.get() orelse jsc.JSValue.js_undefined).toFmt(&formatter), describe.concurrent, @tagName(describe.filter), @tagName(describe.only) });
    defer groupLog.end();

    for (describe.entries.items) |entry| {
        try dumpSub(globalThis, entry);
    }
}
pub fn dumpTest(globalThis: *jsc.JSGlobalObject, current: *ExecutionEntry) bun.JSError!void {
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    groupLog.beginMsg("test {s} / {s} (concurrent={}, only={})", .{ @tagName(current.tag), (current.name.get() orelse jsc.JSValue.js_undefined).toFmt(&formatter), current.concurrent, current.only });
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
const DescribeScope = describe2.DescribeScope;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const TestScheduleEntry = describe2.TestScheduleEntry;
const groupLog = describe2.group;

const test_command = @import("../../cli/test_command.zig");

const bun = @import("bun");
const jsc = bun.jsc;
