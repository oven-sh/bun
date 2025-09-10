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
/// the entries themselves are owned by BunTest, which owns Execution.
#entries: []const *ExecutionEntry,
group_index: usize,

pub const ConcurrentGroup = struct {
    sequence_start: usize,
    sequence_end: usize,
    executing: bool,
    remaining_incomplete_entries: usize,
    /// used by beforeAll to skip directly to afterAll if it fails
    failure_skip_to: usize,

    pub fn init(sequence_start: usize, sequence_end: usize, next_index: usize) ConcurrentGroup {
        return .{
            .sequence_start = sequence_start,
            .sequence_end = sequence_end,
            .executing = false,
            .remaining_incomplete_entries = sequence_end - sequence_start,
            .failure_skip_to = next_index,
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
    /// Index into ExecutionSequence.entries() for the entry that is not started or currently running
    active_index: usize,
    test_entry: ?*ExecutionEntry,
    remaining_repeat_count: i64 = 1,
    result: Result = .pending,
    executing: bool = false,
    started_at: bun.timespec = .epoch,
    /// Number of expect() calls observed in this sequence.
    expect_call_count: u32 = 0,
    /// Expectation set by expect.hasAssertions() or expect.assertions(n).
    expect_assertions: union(enum) {
        not_set,
        at_least_one,
        exact: u32,
    } = .not_set,
    maybe_skip: bool = false,

    /// Start index into `Execution.#entries` (inclusive) for this sequence.
    #entries_start: usize,
    /// End index into `Execution.#entries` (exclusive) for this sequence.
    #entries_end: usize,

    pub fn init(start: usize, end: usize, test_entry: ?*ExecutionEntry) ExecutionSequence {
        return .{
            .#entries_start = start,
            .#entries_end = end,
            .active_index = 0,
            .test_entry = test_entry,
        };
    }

    fn entryMode(this: ExecutionSequence) describe2.ScopeMode {
        if (this.test_entry) |entry| return entry.base.mode;
        return .normal;
    }

    pub fn entries(this: ExecutionSequence, execution: *Execution) []const *ExecutionEntry {
        return execution.#entries[this.#entries_start..this.#entries_end];
    }
    pub fn activeEntry(this: ExecutionSequence, execution: *Execution) ?*ExecutionEntry {
        const entries_value = this.entries(execution);
        if (this.active_index >= entries_value.len) return null;
        return entries_value[this.active_index];
    }
};
pub const Result = enum {
    pending,
    pass,
    skip,
    skipped_because_label,
    todo,
    fail,
    fail_because_timeout,
    fail_because_timeout_with_done_callback,
    fail_because_hook_timeout,
    fail_because_hook_timeout_with_done_callback,
    fail_because_failing_test_passed,
    fail_because_todo_passed,
    fail_because_expected_has_assertions,
    fail_because_expected_assertion_count,

    pub const Basic = enum {
        pending,
        pass,
        fail,
        skip,
        todo,
    };
    pub fn basicResult(this: Result) Basic {
        return switch (this) {
            .pending => .pending,
            .pass => .pass,
            .fail, .fail_because_timeout, .fail_because_timeout_with_done_callback, .fail_because_hook_timeout, .fail_because_hook_timeout_with_done_callback, .fail_because_failing_test_passed, .fail_because_todo_passed, .fail_because_expected_has_assertions, .fail_because_expected_assertion_count => .fail,
            .skip, .skipped_because_label => .skip,
            .todo => .todo,
        };
    }

    pub fn isPass(this: Result, pending_is: enum { pending_is_pass, pending_is_fail }) bool {
        return switch (this.basicResult()) {
            .pass, .skip, .todo => true,
            .fail => false,
            .pending => pending_is == .pending_is_pass,
        };
    }
    pub fn isFail(this: Result) bool {
        return !this.isPass(.pending_is_pass);
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

fn bunTest(this: *Execution) *BunTest {
    return @fieldParentPtr("execution", this);
}

pub fn handleTimeout(this: *Execution, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
    groupLog.begin(@src());
    defer groupLog.end();
    this.bunTest().addResult(.start);
    _ = globalThis;
}

pub fn step(buntest_strong: describe2.BunTestPtr, globalThis: *jsc.JSGlobalObject, data: describe2.BunTest.RefDataValue) bun.JSError!describe2.StepResult {
    groupLog.begin(@src());
    defer groupLog.end();
    const buntest = buntest_strong.get();
    const this = &buntest.execution;

    switch (data) {
        .start => {
            return try stepGroup(buntest_strong, globalThis, bun.timespec.now());
        },
        else => {
            // determine the active sequence,group
            // advance the sequence
            // step the sequence
            // if the group is complete, step the group

            const sequence, const group = this.getCurrentAndValidExecutionSequence(data) orelse {
                groupLog.log("runOneCompleted: the data is outdated, invalid, or did not know the sequence", .{});
                return .{ .waiting = .{} };
            };
            const sequence_index = data.execution.entry_data.?.sequence_index;

            bun.assert(sequence.active_index < sequence.entries(this).len);
            this.advanceSequence(sequence, group);

            const now = bun.timespec.now();
            const sequence_result = try stepSequence(buntest_strong, globalThis, sequence, group, sequence_index, now);
            switch (sequence_result) {
                .done => {},
                .execute => |exec| return .{ .waiting = .{ .timeout = exec.timeout } },
            }
            if (group.remaining_incomplete_entries == 0) {
                return try stepGroup(buntest_strong, globalThis, now);
            }
            return .{ .waiting = .{} };
        },
    }
}

pub fn stepGroup(buntest_strong: describe2.BunTestPtr, globalThis: *jsc.JSGlobalObject, now: bun.timespec) bun.JSError!describe2.StepResult {
    groupLog.begin(@src());
    defer groupLog.end();
    const buntest = buntest_strong.get();
    const this = &buntest.execution;

    while (true) {
        const group = this.activeGroup() orelse return .complete;
        group.executing = true;

        // loop over items in the group and advance their execution

        const status = try stepGroupOne(buntest_strong, globalThis, group, now);
        switch (status) {
            .execute => |exec| return .{ .waiting = .{ .timeout = exec.timeout } },
            .done => {},
        }

        // if there is one sequence and it failed, skip to the next group
        const all_failed = for (group.sequences(this)) |*sequence| {
            if (!sequence.result.isFail()) break false;
        } else true;

        if (all_failed) {
            groupLog.log("stepGroup: all sequences failed, skipping to failure_skip_to group", .{});
            this.group_index = group.failure_skip_to;
        } else {
            groupLog.log("stepGroup: not all sequences failed, advancing to next group", .{});
            this.group_index += 1;
        }
    }
}
const AdvanceStatus = union(enum) { done, execute: struct { timeout: bun.timespec = .epoch } };
fn stepGroupOne(buntest_strong: describe2.BunTestPtr, globalThis: *jsc.JSGlobalObject, group: *ConcurrentGroup, now: bun.timespec) !AdvanceStatus {
    const buntest = buntest_strong.get();
    const this = &buntest.execution;
    var final_status: AdvanceStatus = .done;
    for (group.sequences(this), 0..) |*sequence, sequence_index| {
        const sequence_status = try stepSequence(buntest_strong, globalThis, sequence, group, sequence_index, now);
        switch (sequence_status) {
            .done => {},
            .execute => |exec| {
                const prev_timeout: bun.timespec = if (final_status == .execute) final_status.execute.timeout else .epoch;
                const this_timeout = exec.timeout;
                final_status = .{ .execute = .{ .timeout = prev_timeout.minIgnoreEpoch(this_timeout) } };
            },
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
};
fn stepSequence(buntest_strong: describe2.BunTestPtr, globalThis: *jsc.JSGlobalObject, sequence: *ExecutionSequence, group: *ConcurrentGroup, sequence_index: usize, now: bun.timespec) !AdvanceSequenceStatus {
    while (true) {
        return try stepSequenceOne(buntest_strong, globalThis, sequence, group, sequence_index, now) orelse continue;
    }
}
/// returns null if the while loop should continue
fn stepSequenceOne(buntest_strong: describe2.BunTestPtr, globalThis: *jsc.JSGlobalObject, sequence: *ExecutionSequence, group: *ConcurrentGroup, sequence_index: usize, now: bun.timespec) !?AdvanceSequenceStatus {
    groupLog.begin(@src());
    defer groupLog.end();
    const buntest = buntest_strong.get();
    const this = &buntest.execution;

    if (sequence.executing) {
        const active_entry = sequence.activeEntry(this) orelse {
            bun.debugAssert(false); // sequence is executing with no active entry
            return .{ .execute = .{} };
        };
        if (!active_entry.timespec.eql(&.epoch) and active_entry.timespec.order(&now) == .lt) {
            // timed out
            sequence.result = if (active_entry == sequence.test_entry) if (active_entry.has_done_parameter) .fail_because_timeout_with_done_callback else .fail_because_timeout else if (active_entry.has_done_parameter) .fail_because_hook_timeout_with_done_callback else .fail_because_hook_timeout;
            sequence.maybe_skip = true;
            this.advanceSequence(sequence, group);
            return null; // run again
        }
        groupLog.log("runOne: can't advance; already executing", .{});
        return .{ .execute = .{ .timeout = active_entry.timespec } };
    }

    const next_item = sequence.activeEntry(this) orelse {
        bun.debugAssert(sequence.remaining_repeat_count == 0); // repeat count is decremented when the sequence is advanced, this should only happen if the sequence were empty. which should be impossible.
        groupLog.log("runOne: no repeats left; wait for group completion.", .{});
        return .done;
    };
    sequence.executing = true;
    if (sequence.active_index == 0) {
        this.onSequenceStarted(sequence);
    }
    this.onEntryStarted(next_item);

    if (next_item.callback) |cb| {
        groupLog.log("runSequence queued callback", .{});

        const callback_data: describe2.BunTest.RefDataValue = .{
            .execution = .{
                .group_index = this.group_index,
                .entry_data = .{
                    .sequence_index = sequence_index,
                    .entry_index = sequence.active_index,
                    .remaining_repeat_count = sequence.remaining_repeat_count,
                },
            },
        };
        groupLog.log("runSequence queued callback: {}", .{callback_data});

        try BunTest.runTestCallback(buntest_strong, globalThis, .{ .callback = cb.dupe(this.bunTest().gpa), .done_parameter = next_item.has_done_parameter, .data = callback_data });
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
                groupLog.log("runSequence: no callback for sequence_index {d} (entry_index {d})", .{ sequence_index, sequence.active_index });
                bun.debugAssert(false);
            },
        }
        this.advanceSequence(sequence, group);
        return null; // run again
    }
}
pub fn activeGroup(this: *Execution) ?*ConcurrentGroup {
    if (this.group_index >= this.groups.len) return null;
    return &this.groups[this.group_index];
}
fn getCurrentAndValidExecutionSequence(this: *Execution, data: describe2.BunTest.RefDataValue) ?struct { *ExecutionSequence, *ConcurrentGroup } {
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
    if (sequence.active_index != data.execution.entry_data.?.entry_index) {
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
    if (sequence.activeEntry(this)) |entry| {
        this.onEntryCompleted(entry);
    } else {
        bun.debugAssert(false); // sequence is executing with no active entry?
    }
    sequence.executing = false;
    if (sequence.maybe_skip) {
        sequence.maybe_skip = false;
        const first_aftereach_index = for (sequence.entries(this), 0..) |entry, index| {
            if (entry == sequence.test_entry) break index + 1;
        } else sequence.entries(this).len;
        if (sequence.active_index < first_aftereach_index) {
            sequence.active_index = first_aftereach_index;
        } else {
            sequence.active_index = sequence.entries(this).len;
        }
    } else {
        sequence.active_index += 1;
    }

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
fn onEntryCompleted(_: *Execution, _: *ExecutionEntry) void {}
fn onSequenceCompleted(this: *Execution, sequence: *ExecutionSequence) void {
    const elapsed_ns = sequence.started_at.sinceNow();
    switch (sequence.expect_assertions) {
        .not_set => {},
        .at_least_one => if (sequence.expect_call_count == 0 and sequence.result.isPass(.pending_is_pass)) {
            sequence.result = .fail_because_expected_has_assertions;
        },
        .exact => |expected| if (sequence.expect_call_count != expected and sequence.result.isPass(.pending_is_pass)) {
            sequence.result = .fail_because_expected_assertion_count;
        },
    }
    if (sequence.result == .pending) {
        sequence.result = switch (sequence.entryMode()) {
            .failing => .fail_because_failing_test_passed,
            .todo => .fail_because_todo_passed,
            else => .pass,
        };
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
                        .fail_because_hook_timeout => .timeout,
                        .fail_because_hook_timeout_with_done_callback => .timeout,
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
        sequence.* = .init(sequence.#entries_start, sequence.#entries_end, sequence.test_entry);
    } else {
        // already failed or skipped; don't run again
        sequence.active_index = sequence.entries(this).len;
    }
}

pub fn handleUncaughtException(this: *Execution, user_data: describe2.BunTest.RefDataValue) describe2.HandleUncaughtExceptionResult {
    groupLog.begin(@src());
    defer groupLog.end();

    if (bun.jsc.Jest.Jest.runner) |runner| runner.current_file.printIfNeeded();

    const sequence, const group = this.getCurrentAndValidExecutionSequence(user_data) orelse return .show_unhandled_error_between_tests;
    _ = group;

    sequence.maybe_skip = true;
    if (sequence.activeEntry(this) != sequence.test_entry) {
        // executing hook
        if (sequence.result == .pending) sequence.result = .fail;
        return .show_handled_error;
    }

    return switch (sequence.entryMode()) {
        .failing => {
            if (sequence.result == .pending) sequence.result = .pass; // executing test() callback
            return .hide_error; // failing tests prevent the error from being displayed
        },
        .todo => {
            if (sequence.result == .pending) sequence.result = .todo; // executing test() callback
            return .show_handled_error; // todo tests with --todo will still display the error
        },
        else => {
            if (sequence.result == .pending) sequence.result = .fail;
            return .show_handled_error;
        },
    };
}

const std = @import("std");
const test_command = @import("../../cli/test_command.zig");

const bun = @import("bun");
const jsc = bun.jsc;

const describe2 = jsc.Jest.describe2;
const BunTest = describe2.BunTest;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const Order = describe2.Order;
const groupLog = describe2.debug.group;
