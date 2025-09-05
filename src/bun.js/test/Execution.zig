//! Example:
//!
//! ```
//! Execution[
//!   ConcurrentGroup[
//!     ExecutionSequence[
//!       beforeAll
//!     ]
//!   ],
//!   ConcurrentGroup[ <- group_index (currently running)
//!     ExecutionSequence[
//!       beforeEach,
//!       test.concurrent, <- entry_index (currently running)
//!       afterEach,
//!     ],
//!     ExecutionSequence[
//!       beforeEach,
//!       test.concurrent,
//!       afterEach,
//!       --- <- entry_index (done)
//!     ],
//!   ],
//!   ConcurrentGroup[
//!     ExecutionSequence[
//!       beforeEach,
//!       test,
//!       afterEach,
//!     ],
//!   ],
//!   ConcurrentGroup[
//!     ExecutionSequence[
//!       afterAll
//!     ]
//!   ],
//! ]
//! ```

groups: []ConcurrentGroup,
#sequences: []ExecutionSequence,
#entries: []const *ExecutionEntry,
group_index: usize,

pub const ConcurrentGroup = struct {
    sequence_start: usize,
    sequence_end: usize,
    executing: bool,
    remaining_incomplete_entries: usize,

    pub fn init(sequence_start: usize, sequence_end: usize) ConcurrentGroup {
        return .{
            .sequence_start = sequence_start,
            .sequence_end = sequence_end,
            .executing = false,
            .remaining_incomplete_entries = sequence_end - sequence_start,
        };
    }
    pub fn tryExtend(this: *ConcurrentGroup, next_sequence_start: usize, next_sequence_end: usize) bool {
        if (this.sequence_end != next_sequence_start) return false;
        this.sequence_end = next_sequence_end;
        this.remaining_incomplete_entries = this.sequence_end - this.sequence_start;
        return true;
    }

    pub fn sequences(this: ConcurrentGroup, execution: *Execution) []ExecutionSequence {
        return execution.#sequences[this.sequence_start..this.sequence_end];
    }
};
pub const ExecutionSequence = struct {
    entries_start: usize,
    entries_end: usize,
    index: usize,
    test_entry: ?*ExecutionEntry,
    remaining_repeat_count: i64 = 1,
    result: Result = .pending,
    executing: bool = false,
    started_at: bun.timespec = .epoch,
    expect_call_count: u32 = 0,
    expect_assertions: union(enum) {
        not_set,
        at_least_one,
        exact: u32,
    } = .not_set,

    pub fn init(start: usize, end: usize, test_entry: ?*ExecutionEntry) ExecutionSequence {
        return .{
            .entries_start = start,
            .entries_end = end,
            .index = 0,
            .test_entry = test_entry,
        };
    }

    fn entryMode(this: ExecutionSequence) describe2.ScopeMode {
        if (this.test_entry) |entry| return entry.base.mode;
        return .normal;
    }

    pub fn entries(this: ExecutionSequence, execution: *Execution) []const *ExecutionEntry {
        return execution.#entries[this.entries_start..this.entries_end];
    }
    pub fn activeEntry(this: ExecutionSequence, execution: *Execution) ?*ExecutionEntry {
        const entries_value = this.entries(execution);
        if (this.index >= entries_value.len) return null;
        return entries_value[this.index];
    }
};
pub const Result = enum {
    pending,
    pass,
    fail,
    skip,
    todo,
    fail_because_timeout,
    fail_because_timeout_with_done_callback,
    skipped_because_label,
    fail_because_failing_test_passed,
    fail_because_todo_passed,
    fail_because_expected_has_assertions,
    fail_because_expected_assertion_count,

    pub fn isPass(this: Result, pending_is: enum { pending_is_pass, pending_is_fail }) bool {
        return switch (this) {
            .pass, .skip, .todo, .skipped_because_label => true,
            .fail, .fail_because_timeout, .fail_because_timeout_with_done_callback, .fail_because_failing_test_passed, .fail_because_todo_passed, .fail_because_expected_has_assertions, .fail_because_expected_assertion_count => false,
            .pending => pending_is == .pending_is_pass,
        };
    }

    fn switchPassAndFail(this: Result, failure: Result) Result {
        switch (this) {
            .pass => return failure,
            .fail => return .pass,
            else => return this, // note that this includes other fail reasons (eg fail_because_expected_has_assertions, fail_because_timeout).
        }
    }
};
const EntryID = enum(usize) {
    none = std.math.maxInt(usize),
    _,
};

pub fn init(_: std.mem.Allocator) Execution {
    return .{
        .groups = &.{},
        .#sequences = &.{},
        .#entries = &.{},
        .group_index = 0,
    };
}
pub fn deinit(this: *Execution) void {
    this.bunTest().gpa.free(this.groups);
    this.bunTest().gpa.free(this.#sequences);
    this.bunTest().gpa.free(this.#entries);
}
pub fn loadFromOrder(this: *Execution, order: *Order) bun.JSError!void {
    bun.assert(this.groups.len == 0);
    bun.assert(this.#sequences.len == 0);
    bun.assert(this.#entries.len == 0);
    var alloc_safety = bun.safety.CheckedAllocator.init(this.bunTest().gpa);
    alloc_safety.assertEq(order.groups.allocator);
    alloc_safety.assertEq(order.sequences.allocator);
    alloc_safety.assertEq(order.entries.allocator);
    this.groups = try order.groups.toOwnedSlice();
    this.#sequences = try order.sequences.toOwnedSlice();
    this.#entries = try order.entries.toOwnedSlice();
}

fn bunTest(this: *Execution) *BunTestFile {
    return @fieldParentPtr("execution", this);
}

pub fn handleTimeout(this: *Execution, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
    groupLog.begin(@src());
    defer groupLog.end();
    // TODO: implement me
    this.bunTest().addResult(.start); // good enough for now
    _ = globalThis;
}

pub fn step(this: *Execution, globalThis: *jsc.JSGlobalObject, data: describe2.BunTestFile.RefDataValue) bun.JSError!describe2.StepResult {
    groupLog.begin(@src());
    defer groupLog.end();

    if (data != .start) try this.runOneCompleted(globalThis, null, data);
    const result = try this.runOne(globalThis);

    return result;
}

pub fn runOne(this: *Execution, globalThis: *jsc.JSGlobalObject) bun.JSError!describe2.StepResult {
    groupLog.begin(@src());
    defer groupLog.end();

    const now = bun.timespec.now();

    while (true) {
        const group = this.activeGroup() orelse return .complete;
        group.executing = true;

        // loop over items in the group and advance their execution

        const status = try this.advanceSequencesInGroup(globalThis, group, now);
        switch (status) {
            .execute => |exec| return .{ .waiting = .{ .timeout = exec.timeout } },
            .done => {},
        }
        this.group_index += 1;
    }
}
const AdvanceStatus = union(enum) { done, execute: struct { timeout: bun.timespec = .epoch } };
fn advanceSequencesInGroup(this: *Execution, globalThis: *jsc.JSGlobalObject, group: *ConcurrentGroup, now: bun.timespec) !AdvanceStatus {
    var final_status: AdvanceStatus = .done;
    for (group.sequences(this), 0..) |*sequence, sequence_index| {
        while (true) {
            const sequence_status = try this.advanceSequenceInGroup(globalThis, sequence, group, sequence_index, now);
            switch (sequence_status) {
                .done => {},
                .execute => |exec| {
                    const prev_timeout: bun.timespec = if (final_status == .execute) final_status.execute.timeout else .epoch;
                    const this_timeout = exec.timeout;
                    final_status = .{ .execute = .{ .timeout = prev_timeout.minIgnoreEpoch(this_timeout) } };
                },
                .again => continue,
            }
            break;
        }
    }
    return final_status;
}
const AdvanceSequenceStatus = union(enum) {
    /// the entire sequence is completed.
    done,
    /// the item is queued for execution or has not completed yet. need to wait for it
    execute: struct {
        timeout: bun.timespec = .epoch,
    },
    /// the item completed immediately; advance to the next item
    again,
};
fn advanceSequenceInGroup(this: *Execution, globalThis: *jsc.JSGlobalObject, sequence: *ExecutionSequence, group: *ConcurrentGroup, sequence_index: usize, now: bun.timespec) !AdvanceSequenceStatus {
    groupLog.begin(@src());
    defer groupLog.end();

    if (sequence.executing) {
        const active_entry = sequence.activeEntry(this) orelse {
            bun.debugAssert(false); // sequence is executing with no active entry
            return .{ .execute = .{} };
        };
        if (!active_entry.timespec.eql(&.epoch) and active_entry.timespec.order(&now) == .lt) {
            // timed out
            sequence.result = if (active_entry.has_done_parameter) .fail_because_timeout_with_done_callback else .fail_because_timeout;
            this.advanceSequence(sequence, group);
            return .again;
        }
        groupLog.log("runOne: can't advance; already executing", .{});
        return .{ .execute = .{ .timeout = active_entry.timespec } };
    }

    const next_item = sequence.activeEntry(this) orelse {
        bun.assert(sequence.remaining_repeat_count == 0);
        groupLog.log("runOne: no repeats left; wait for group completion.", .{});
        return .done;
    };
    sequence.executing = true;
    if (sequence.index == 0) {
        this.onSequenceStarted(sequence);
    }
    this.onEntryStarted(next_item);

    // switch(executeEntry) {.immediate => continue, .queued => {}}

    if (next_item.callback) |cb| {
        groupLog.log("runSequence queued callback", .{});

        const callback_data: describe2.BunTestFile.RefDataValue = .{
            .execution = .{
                .group_index = this.group_index,
                .entry_data = .{
                    .sequence_index = sequence_index,
                    .entry_index = sequence.index,
                    .remaining_repeat_count = sequence.remaining_repeat_count,
                },
            },
        };
        groupLog.log("runSequence queued callback: {}", .{callback_data});

        try this.bunTest().runTestCallback(globalThis, .{ .callback = cb.dupe(this.bunTest().gpa), .done_parameter = next_item.has_done_parameter, .data = callback_data });
        return .{ .execute = .{ .timeout = next_item.timespec } };
    } else {
        switch (next_item.base.mode) {
            .skip => if (sequence.result == .pending) {
                sequence.result = .skip;
            },
            .todo => if (sequence.result == .pending) {
                sequence.result = .todo;
            },
            .filtered_out => if (sequence.result == .pending) {
                sequence.result = .skipped_because_label;
            },
            else => {
                groupLog.log("runSequence: no callback for sequence_index {d} (entry_index {d})", .{ sequence_index, sequence.index });
                bun.debugAssert(false);
            },
        }
        this.advanceSequence(sequence, group);
        return .again;
    }
}
pub fn activeGroup(this: *Execution) ?*ConcurrentGroup {
    if (this.group_index >= this.groups.len) return null;
    return &this.groups[this.group_index];
}
pub fn runOneCompleted(this: *Execution, _: *jsc.JSGlobalObject, _: ?jsc.JSValue, data: describe2.BunTestFile.RefDataValue) bun.JSError!void {
    groupLog.begin(@src());
    defer groupLog.end();

    groupLog.log("runOneCompleted", .{});

    bun.assert(this.group_index < this.groups.len);

    const sequence, const group = this.getCurrentAndValidExecutionSequence(data) orelse {
        groupLog.log("runOneCompleted: the data is outdated, invalid, or did not know the sequence", .{});
        return;
    };

    bun.assert(sequence.index < sequence.entries(this).len);
    this.advanceSequence(sequence, group);
}
fn getCurrentAndValidExecutionSequence(this: *Execution, data: describe2.BunTestFile.RefDataValue) ?struct { *ExecutionSequence, *ConcurrentGroup } {
    groupLog.begin(@src());
    defer groupLog.end();

    groupLog.log("runOneCompleted: data: {}", .{data});

    if (data != .execution) {
        groupLog.log("runOneCompleted: the data is not execution", .{});
        return null;
    }
    if (data.execution.entry_data == null) {
        groupLog.log("runOneCompleted: the data did not know which entry was active in the group", .{});
        return null;
    }
    if (this.activeGroup() != data.group(this.bunTest())) {
        groupLog.log("runOneCompleted: the data is for a different group", .{});
        return null;
    }
    const group = data.group(this.bunTest()) orelse {
        groupLog.log("runOneCompleted: the data did not know the group", .{});
        return null;
    };
    const sequence = data.sequence(this.bunTest()) orelse {
        groupLog.log("runOneCompleted: the data did not know the sequence", .{});
        return null;
    };
    if (sequence.remaining_repeat_count != data.execution.entry_data.?.remaining_repeat_count) {
        groupLog.log("runOneCompleted: the data is for a previous repeat count (outdated)", .{});
        return null;
    }
    if (sequence.index != data.execution.entry_data.?.entry_index) {
        groupLog.log("runOneCompleted: the data is for a different sequence index (outdated)", .{});
        return null;
    }
    groupLog.log("runOneCompleted: the data is valid and current", .{});
    return .{ sequence, group };
}
fn advanceSequence(this: *Execution, sequence: *ExecutionSequence, group: *ConcurrentGroup) void {
    groupLog.begin(@src());
    defer groupLog.end();

    bun.assert(sequence.executing);
    sequence.executing = false;
    sequence.index += 1;

    if (sequence.activeEntry(this) == null) {
        // just completed the sequence
        this.onSequenceCompleted(sequence);
        sequence.remaining_repeat_count -= 1;
        if (sequence.remaining_repeat_count <= 0) {
            // no repeats left; indicate completion
            if (group.remaining_incomplete_entries == 0) {
                bun.debugAssert(false); // remaining_incomplete_entries should never go below 0
                return;
            }
            group.remaining_incomplete_entries -= 1;
        } else {
            this.resetSequence(sequence);
        }
    }
}
fn onSequenceStarted(_: *Execution, sequence: *ExecutionSequence) void {
    sequence.started_at = bun.timespec.now();

    if (sequence.test_entry) |entry| {
        if (entry.base.test_id_for_debugger != 0) {
            if (jsc.VirtualMachine.get().debugger) |*debugger| {
                if (debugger.test_reporter_agent.isEnabled()) {
                    debugger.test_reporter_agent.reportTestStart(entry.base.test_id_for_debugger);
                }
            }
        }
    }
}
fn onEntryStarted(_: *Execution, entry: *ExecutionEntry) void {
    if (entry.timeout != std.math.maxInt(u32)) {
        entry.timespec = bun.timespec.msFromNow(entry.timeout);
    } else {
        entry.timespec = .epoch;
    }
}
fn onSequenceCompleted(this: *Execution, sequence: *ExecutionSequence) void {
    const elapsed_ns = sequence.started_at.sinceNow();
    if (sequence.result == .pending) {
        sequence.result = .pass;
    }
    switch (sequence.expect_assertions) {
        .not_set => {},
        .at_least_one => if (sequence.expect_call_count == 0 and sequence.result.isPass(.pending_is_pass)) {
            sequence.result = .fail_because_expected_has_assertions;
        },
        .exact => |expected| if (sequence.expect_call_count != expected and sequence.result.isPass(.pending_is_pass)) {
            sequence.result = .fail_because_expected_assertion_count;
        },
    }
    switch (sequence.entryMode()) {
        .failing => sequence.result = sequence.result.switchPassAndFail(.fail_because_failing_test_passed),
        .todo => sequence.result = sequence.result.switchPassAndFail(.fail_because_todo_passed),
        else => {},
    }
    const entries = sequence.entries(this);
    if (entries.len > 0 and (sequence.test_entry != null or sequence.result != .pass)) {
        test_command.CommandLineReporter.handleTestCompleted(this.bunTest(), sequence, sequence.test_entry orelse entries[0], elapsed_ns);
    }

    if (sequence.test_entry) |entry| {
        if (entry.base.test_id_for_debugger != 0) {
            if (jsc.VirtualMachine.get().debugger) |*debugger| {
                if (debugger.test_reporter_agent.isEnabled()) {
                    debugger.test_reporter_agent.reportTestEnd(entry.base.test_id_for_debugger, switch (sequence.result) {
                        .pass => .pass,
                        .fail => .fail,
                        .skip => .skip,
                        .fail_because_timeout => .timeout,
                        .fail_because_timeout_with_done_callback => .timeout,
                        .todo => .todo,
                        .skipped_because_label => .skipped_because_label,
                        .fail_because_failing_test_passed => .fail,
                        .fail_because_todo_passed => .fail,
                        .fail_because_expected_has_assertions => .fail,
                        .fail_because_expected_assertion_count => .fail,
                        .pending => .timeout,
                    }, @floatFromInt(elapsed_ns));
                }
            }
        }
    }
}
pub fn resetSequence(this: *Execution, sequence: *ExecutionSequence) void {
    bun.assert(!sequence.executing);
    if (sequence.result.isPass(.pending_is_pass)) {
        // passed or pending; run again
        sequence.* = .init(sequence.entries_start, sequence.entries_end, sequence.test_entry);
    } else {
        // already failed or skipped; don't run again
        sequence.index = sequence.entries(this).len;
    }
}

pub fn handleUncaughtException(this: *Execution, user_data: describe2.BunTestFile.RefDataValue) describe2.HandleUncaughtExceptionResult {
    groupLog.begin(@src());
    defer groupLog.end();

    const sequence, const group = this.getCurrentAndValidExecutionSequence(user_data) orelse return .show_unhandled_error_between_tests;
    _ = group;

    if (sequence.activeEntry(this) != sequence.test_entry) {
        // error in a hook
        // TODO: hooks should prevent further execution of the sequence and maybe shouldn't be marked as "between tests" but instead a regular failure
        return .show_unhandled_error_between_tests;
    }

    sequence.result = .fail;
    return switch (sequence.entryMode()) {
        .failing => .hide_error, // failing tests prevent the error from being displayed
        .todo => .show_handled_error, // todo tests with --todo will still display the error
        else => .show_handled_error,
    };
}

const std = @import("std");
const test_command = @import("../../cli/test_command.zig");

const bun = @import("bun");
const jsc = bun.jsc;

const describe2 = jsc.Jest.describe2;
const BunTestFile = describe2.BunTestFile;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const Order = describe2.Order;
const groupLog = describe2.debug.group;
