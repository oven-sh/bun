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
@"#sequences": []ExecutionSequence,
@"#entries": []const *ExecutionEntry,
group_index: usize,

pub const CurrentEntryRef = struct {
    _internal_ref: *bun.jsc.Jest.describe2.BunTestFile.RefData,
    buntest: *BunTestFile,
    group_index: usize,
    entry_data: ?struct {
        sequence_index: usize,
        entry_index: usize,
    },

    pub fn deinit(this: *CurrentEntryRef) void {
        this._internal_ref.deinit();
        this.buntest = undefined;
    }

    pub fn group(this: *const CurrentEntryRef) *ConcurrentGroup {
        return &this.buntest.execution.groups[this.group_index];
    }
    pub fn sequence(this: *const CurrentEntryRef) ?*ExecutionSequence {
        const entry_data = this.entry_data orelse return null;
        return &this.buntest.execution.@"#sequences"[entry_data.sequence_index];
    }
    pub fn entry(this: *const CurrentEntryRef) ?*ExecutionEntry {
        const entry_data = this.entry_data orelse return null;
        return this.buntest.execution.@"#entries"[entry_data.entry_index];
    }
};

pub const ConcurrentGroup = struct {
    @"#sequence_start": usize,
    @"#sequence_end": usize,
    executing: bool = false,

    pub fn sequences(this: ConcurrentGroup, execution: *Execution) []ExecutionSequence {
        return execution.@"#sequences"[this.@"#sequence_start"..this.@"#sequence_end"];
    }
};
pub const ExecutionSequence = struct {
    @"#entries_start": usize,
    @"#entries_end": usize,
    index: usize,
    test_entry: ?*ExecutionEntry,
    remaining_repeat_count: f64 = 1,
    result: Result = .pending,
    executing: bool = false,
    started_at: bun.timespec = bun.timespec.epoch,
    expect_call_count: u32 = 0, // TODO: impl incrementExpectCallCounter to increment this number and others

    fn entryMode(this: ExecutionSequence) describe2.ScopeMode {
        if (this.test_entry) |entry| return entry.base.mode;
        return .normal;
    }

    pub fn entries(this: ExecutionSequence, execution: *Execution) []const *ExecutionEntry {
        return execution.@"#entries"[this.@"#entries_start"..this.@"#entries_end"];
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

pub fn init(_: std.mem.Allocator) Execution {
    return .{
        .groups = &.{},
        .@"#sequences" = &.{},
        .@"#entries" = &.{},
        .group_index = 0,
    };
}
pub fn deinit(this: *Execution) void {
    this.bunTest().gpa.free(this.groups);
    this.bunTest().gpa.free(this.@"#sequences");
    this.bunTest().gpa.free(this.@"#entries");
}
pub fn loadFromOrder(this: *Execution, order: *Order) bun.JSError!void {
    bun.assert(this.groups.len == 0);
    bun.assert(this.@"#sequences".len == 0);
    bun.assert(this.@"#entries".len == 0);
    var allocator_safety = bun.safety.AllocPtr.init(this.bunTest().gpa);
    allocator_safety.assertEq(order.groups.allocator);
    allocator_safety.assertEq(order.sequences.allocator);
    allocator_safety.assertEq(order.entries.allocator);
    this.groups = try order.groups.toOwnedSlice();
    this.@"#sequences" = try order.sequences.toOwnedSlice();
    this.@"#entries" = try order.entries.toOwnedSlice();
}

fn bunTest(this: *Execution) *BunTestFile {
    return @fieldParentPtr("execution", this);
}

pub fn runOne(this: *Execution, _: *jsc.JSGlobalObject, callback_queue: *describe2.CallbackQueue) bun.JSError!describe2.RunOneResult {
    groupLog.begin(@src());
    defer groupLog.end();

    while (true) {
        if (this.group_index >= this.groups.len) return .done;

        this.groups[this.group_index].executing = true;

        // loop over items in the group and advance their execution
        const group = &this.groups[this.group_index];
        if (!group.executing) this.resetGroup(this.group_index);
        var status: describe2.RunOneResult = .done;
        for (group.sequences(this), group.@"#sequence_start"..) |*sequence, sequence_raw_index| {
            while (true) {
                groupLog.begin(@src());
                defer groupLog.end();

                if (sequence.executing) {
                    groupLog.log("runOne: can't advance; already executing", .{});
                    status = .execute; // can't advance; already executing
                    break;
                }

                const next_item = sequence.activeEntry(this) orelse {
                    bun.assert(sequence.remaining_repeat_count == 0);
                    groupLog.log("runOne: no repeats left; wait for group completion.", .{});
                    break; // done
                };
                sequence.executing = true;
                this.onSequenceStarted(sequence);

                if (next_item.callback) |cb| {
                    groupLog.log("runSequence queued callback", .{});

                    try callback_queue.append(.{ .callback = cb.dupe(this.bunTest().gpa), .done_parameter = true, .data = sequence_raw_index });
                    status = .execute;
                    break;
                } else {
                    switch (next_item.base.mode) {
                        .skip => if (sequence.result == .pending) {
                            sequence.result = .skip;
                        },
                        .todo => if (sequence.result == .pending) {
                            sequence.result = .todo;
                        },
                        else => {
                            groupLog.log("runSequence: no callback for sequence_index {d} (entry_index {d})", .{ sequence_raw_index, sequence.index });
                            bun.debugAssert(false);
                        },
                    }
                    sequence.executing = false;
                    sequence.index += 1;
                    continue;
                }
                comptime unreachable;
            }
        }

        if (status == .execute) return .execute;
        this.group_index += 1;
    }
}
pub fn runOneCompleted(this: *Execution, _: *jsc.JSGlobalObject, _: ?jsc.JSValue, data: u64) bun.JSError!void {
    groupLog.begin(@src());
    defer groupLog.end();

    const sequence_index: usize = @intCast(data); // TODO: ??????????? validate
    groupLog.log("runOneCompleted sequence_index {d}", .{sequence_index});

    bun.assert(this.group_index < this.groups.len);
    const group = &this.groups[this.group_index];

    if (sequence_index < group.@"#sequence_start" or sequence_index >= group.@"#sequence_end") {
        bun.debugAssert(false);
        return;
    }
    const sequences = group.sequences(this);
    const sequence = &sequences[sequence_index - group.@"#sequence_start"];
    bun.assert(sequence.index < sequence.entries(this).len);

    sequence.executing = false;
    sequence.index += 1;

    if (sequence.activeEntry(this) == null) {
        // just completed the sequence
        this.onSequenceCompleted(sequence);
        sequence.remaining_repeat_count -= 1;
        if (sequence.remaining_repeat_count <= 0) {
            // no repeats left; wait for group completion
        } else {
            this.resetSequence(sequence);
        }
    }

    // TODO: see what vitest does when a beforeAll fails. does it still run the test?
}
fn onSequenceStarted(_: *Execution, sequence: *ExecutionSequence) void {
    sequence.started_at = bun.timespec.now();
}
fn onSequenceCompleted(this: *Execution, sequence: *ExecutionSequence) void {
    const elapsed_ns = sequence.started_at.sinceNow();
    if (sequence.result == .pending) {
        sequence.result = .pass;
    }
    switch (sequence.entryMode()) {
        .failing => {
            sequence.result = switch (sequence.result) {
                .fail => .pass,
                .pass => .fail_because_failing_test_passed,
                else => sequence.result,
            };
        },
        .todo => {
            sequence.result = switch (sequence.result) {
                .fail => .todo,
                .pass => .fail_because_todo_passed,
                else => sequence.result,
            };
        },
        else => {},
    }
    const entries = sequence.entries(this);
    if (entries.len > 0 and (sequence.test_entry != null or sequence.result != .pass)) {
        test_command.CommandLineReporter.handleTestCompleted(this.bunTest(), sequence, sequence.test_entry orelse entries[0], elapsed_ns);
    }
}
pub fn resetGroup(this: *Execution, group_index: usize) void {
    groupLog.begin(@src());
    defer groupLog.end();

    const group = this.groups[group_index];
    bun.assert(!group.executing);
    for (group.sequences(this)) |*sequence| {
        this.resetSequence(sequence);
    }
}
pub fn resetSequence(this: *Execution, sequence: *ExecutionSequence) void {
    bun.assert(!sequence.executing);
    if (sequence.result.isPass()) {
        // passed or pending; run again
        sequence.index = 0;
        sequence.result = .pending;
    } else {
        // already failed or skipped; don't run again
        sequence.index = sequence.entries(this).len;
    }
}

pub fn handleUncaughtException(this: *Execution, user_data: ?u64) describe2.HandleUncaughtExceptionResult {
    groupLog.begin(@src());
    defer groupLog.end();

    const current_group = this.groups[this.group_index];
    const sequences = current_group.sequences(this);
    const sequence: *ExecutionSequence = if (sequences.len == 1) blk: {
        groupLog.log("handleUncaughtException: there is only one sequence in the group", .{});
        break :blk &sequences[0];
    } else if (user_data != null and user_data.? >= current_group.@"#sequence_start" and user_data.? < current_group.@"#sequence_end") blk: {
        groupLog.log("handleUncaughtException: there are multiple sequences in the group and user_data is provided", .{});
        break :blk &sequences[user_data.? - current_group.@"#sequence_start"];
    } else {
        groupLog.log("handleUncaughtException: there are multiple sequences in the group and user_data is not provided or invalid", .{});
        return .show_unhandled_error_between_tests;
    };

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

const describe2 = @import("./describe2.zig");
const BunTestFile = describe2.BunTestFile;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const groupLog = describe2.group;

const bun = @import("bun");
const jsc = bun.jsc;
const Order = describe2.Order;
