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
group_index: usize,

pub const ConcurrentGroup = struct {
    sequence_start: usize,
    sequence_end: usize,
    /// Index of the next sequence that has not been started yet
    next_sequence_index: usize,
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
            .next_sequence_index = 0,
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
    first_entry: ?*ExecutionEntry,
    /// Index into ExecutionSequence.entries() for the entry that is not started or currently running
    active_entry: ?*ExecutionEntry,
    test_entry: ?*ExecutionEntry,
    remaining_repeat_count: u32,
    remaining_retry_count: u32,
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

    pub fn init(cfg: struct {
        first_entry: ?*ExecutionEntry,
        test_entry: ?*ExecutionEntry,
        retry_count: u32 = 0,
        repeat_count: u32 = 0,
    }) ExecutionSequence {
        return .{
            .first_entry = cfg.first_entry,
            .active_entry = cfg.first_entry,
            .test_entry = cfg.test_entry,
            .remaining_repeat_count = cfg.repeat_count,
            .remaining_retry_count = cfg.retry_count,
        };
    }

    fn entryMode(this: ExecutionSequence) bun_test.ScopeMode {
        if (this.test_entry) |entry| return entry.base.mode;
        return .normal;
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
pub fn init(_: std.mem.Allocator) Execution {
    return .{
        .groups = &.{},
        .#sequences = &.{},
        .group_index = 0,
    };
}
pub fn deinit(this: *Execution) void {
    this.bunTest().gpa.free(this.groups);
    this.bunTest().gpa.free(this.#sequences);
}
pub fn loadFromOrder(this: *Execution, order: *Order) bun.JSError!void {
    bun.assert(this.groups.len == 0);
    bun.assert(this.#sequences.len == 0);
    var alloc_safety = bun.safety.CheckedAllocator.init(this.bunTest().gpa);
    alloc_safety.assertEq(order.groups.allocator);
    alloc_safety.assertEq(order.sequences.allocator);
    this.groups = try order.groups.toOwnedSlice();
    this.#sequences = try order.sequences.toOwnedSlice();
}

fn bunTest(this: *Execution) *BunTest {
    return @fieldParentPtr("execution", this);
}

pub fn handleTimeout(this: *Execution, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
    groupLog.begin(@src());
    defer groupLog.end();

    // if the concurrent group has one sequence and the sequence has an active entry that has timed out,
    //   kill any dangling processes
    // when using test.concurrent(), we can't do this because it could kill multiple tests at once.
    if (this.activeGroup()) |current_group| {
        const sequences = current_group.sequences(this);
        if (sequences.len == 1) {
            const sequence = sequences[0];
            if (sequence.active_entry) |entry| {
                const now = bun.timespec.now(.force_real_time);
                if (entry.timespec.order(&now) == .lt) {
                    const kill_count = globalThis.bunVM().auto_killer.kill();
                    if (kill_count.processes > 0) {
                        bun.Output.prettyErrorln("<d>killed {d} dangling process{s}<r>", .{ kill_count.processes, if (kill_count.processes != 1) "es" else "" });
                        bun.Output.flush();
                    }
                }
            }
        }
    }

    this.bunTest().addResult(.start);
}

pub fn step(buntest_strong: bun_test.BunTestPtr, globalThis: *jsc.JSGlobalObject, data: bun_test.BunTest.RefDataValue) bun.JSError!bun_test.StepResult {
    groupLog.begin(@src());
    defer groupLog.end();
    const buntest = buntest_strong.get();
    const this = &buntest.execution;
    var now = bun.timespec.now(.force_real_time);

    switch (data) {
        .start => {
            return try stepGroup(buntest_strong, globalThis, &now);
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

            if (bun.Environment.ci_assert) bun.assert(sequence.active_entry != null);
            this.advanceSequence(sequence, group);

            const sequence_result = try stepSequence(buntest_strong, globalThis, group, sequence_index, &now);
            switch (sequence_result) {
                .done => {},
                .execute => |exec| return .{ .waiting = .{ .timeout = exec.timeout } },
            }
            // this sequence is complete; execute the next sequence
            while (group.next_sequence_index < group.sequences(this).len) : (group.next_sequence_index += 1) {
                const target_sequence = &group.sequences(this)[group.next_sequence_index];
                if (target_sequence.executing) continue;
                const sequence_status = try stepSequence(buntest_strong, globalThis, group, group.next_sequence_index, &now);
                switch (sequence_status) {
                    .done => continue,
                    .execute => |exec| {
                        return .{ .waiting = .{ .timeout = exec.timeout } };
                    },
                }
            }
            // all sequences have started
            if (group.remaining_incomplete_entries == 0) {
                return try stepGroup(buntest_strong, globalThis, &now);
            }
            return .{ .waiting = .{} };
        },
    }
}

pub fn stepGroup(buntest_strong: bun_test.BunTestPtr, globalThis: *jsc.JSGlobalObject, now: *bun.timespec) bun.JSError!bun_test.StepResult {
    groupLog.begin(@src());
    defer groupLog.end();
    const buntest = buntest_strong.get();
    const this = &buntest.execution;

    while (true) {
        const group = this.activeGroup() orelse return .complete;
        if (!group.executing) {
            this.onGroupStarted(group, globalThis);
            group.executing = true;
        }

        // loop over items in the group and advance their execution

        const status = try stepGroupOne(buntest_strong, globalThis, group, now);
        switch (status) {
            .execute => |exec| return .{ .waiting = .{ .timeout = exec.timeout } },
            .done => {},
        }

        group.executing = false;
        this.onGroupCompleted(group, globalThis);

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
fn stepGroupOne(buntest_strong: bun_test.BunTestPtr, globalThis: *jsc.JSGlobalObject, group: *ConcurrentGroup, now: *bun.timespec) !AdvanceStatus {
    const buntest = buntest_strong.get();
    const this = &buntest.execution;
    var final_status: AdvanceStatus = .done;
    const concurrent_limit = if (buntest.reporter) |reporter| reporter.jest.max_concurrency else blk: {
        bun.assert(false); // probably can't get here because reporter is only set null when the file is exited
        break :blk 20;
    };
    var active_count: usize = 0;
    for (0..group.sequences(this).len) |sequence_index| {
        const sequence_status = try stepSequence(buntest_strong, globalThis, group, sequence_index, now);
        switch (sequence_status) {
            .done => {},
            .execute => |exec| {
                const prev_timeout: bun.timespec = if (final_status == .execute) final_status.execute.timeout else .epoch;
                const this_timeout = exec.timeout;
                final_status = .{ .execute = .{ .timeout = prev_timeout.minIgnoreEpoch(this_timeout) } };
                active_count += 1;
                if (concurrent_limit != 0 and active_count >= concurrent_limit) break;
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
fn stepSequence(buntest_strong: bun_test.BunTestPtr, globalThis: *jsc.JSGlobalObject, group: *ConcurrentGroup, sequence_index: usize, now: *bun.timespec) !AdvanceSequenceStatus {
    while (true) {
        return try stepSequenceOne(buntest_strong, globalThis, group, sequence_index, now) orelse continue;
    }
}
/// returns null if the while loop should continue
fn stepSequenceOne(buntest_strong: bun_test.BunTestPtr, globalThis: *jsc.JSGlobalObject, group: *ConcurrentGroup, sequence_index: usize, now: *bun.timespec) !?AdvanceSequenceStatus {
    groupLog.begin(@src());
    defer groupLog.end();
    const buntest = buntest_strong.get();
    const this = &buntest.execution;

    const sequence = &group.sequences(this)[sequence_index];
    if (sequence.executing) {
        const active_entry = sequence.active_entry orelse {
            bun.debugAssert(false); // sequence is executing with no active entry
            return .{ .execute = .{} };
        };
        if (active_entry.evaluateTimeout(sequence, now)) {
            this.advanceSequence(sequence, group);
            return null; // run again
        }
        groupLog.log("runOne: can't advance; already executing", .{});
        return .{ .execute = .{ .timeout = active_entry.timespec } };
    }

    const next_item = sequence.active_entry orelse {
        // Sequence is complete - either because:
        // 1. It ran out of entries (normal completion)
        // 2. All retry/repeat attempts have been exhausted
        groupLog.log("runOne: no more entries; sequence complete.", .{});
        return .done;
    };
    sequence.executing = true;
    if (next_item == sequence.first_entry) {
        this.onSequenceStarted(sequence);
    }
    this.onEntryStarted(next_item);

    if (next_item.callback) |cb| {
        groupLog.log("runSequence queued callback", .{});

        const callback_data: bun_test.BunTest.RefDataValue = .{
            .execution = .{
                .group_index = this.group_index,
                .entry_data = .{
                    .sequence_index = sequence_index,
                    .entry = next_item,
                    .remaining_repeat_count = sequence.remaining_repeat_count,
                },
            },
        };
        groupLog.log("runSequence queued callback: {f}", .{callback_data});

        if (BunTest.runTestCallback(buntest_strong, globalThis, cb.get(), next_item.has_done_parameter, callback_data, &next_item.timespec) != null) {
            now.* = bun.timespec.now(.force_real_time);
            _ = next_item.evaluateTimeout(sequence, now);

            // the result is available immediately; advance the sequence and run again.
            this.advanceSequence(sequence, group);
            return null; // run again
        }
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
                groupLog.log("runSequence: no callback for sequence_index {d} (entry_index {x})", .{ sequence_index, @intFromPtr(sequence.active_entry) });
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
pub fn getCurrentAndValidExecutionSequence(this: *Execution, data: bun_test.BunTest.RefDataValue) ?struct { *ExecutionSequence, *ConcurrentGroup } {
    groupLog.begin(@src());
    defer groupLog.end();

    groupLog.log("runOneCompleted: data: {f}", .{data});

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
    if (@as(?*anyopaque, sequence.active_entry) != data.execution.entry_data.?.entry) {
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
    if (sequence.active_entry) |entry| {
        this.onEntryCompleted(entry);

        sequence.executing = false;
        if (sequence.maybe_skip) {
            sequence.maybe_skip = false;
            sequence.active_entry = if (entry.failure_skip_past) |failure_skip_past| failure_skip_past.next else null;
        } else {
            sequence.active_entry = entry.next;
        }
    } else {
        if (bun.Environment.ci_assert) bun.assert(false); // can't call advanceSequence on a completed sequence
    }

    if (sequence.active_entry == null) {
        // just completed the sequence
        const test_failed = sequence.result.isFail();
        const test_passed = sequence.result.isPass(.pending_is_pass);

        // Handle retry logic: if test failed and we have retries remaining, retry it
        if (test_failed and sequence.remaining_retry_count > 0) {
            sequence.remaining_retry_count -= 1;
            this.resetSequence(sequence);
            return;
        }

        // Handle repeat logic: if test passed and we have repeats remaining, repeat it
        if (test_passed and sequence.remaining_repeat_count > 0) {
            sequence.remaining_repeat_count -= 1;
            this.resetSequence(sequence);
            return;
        }

        // Only report the final result after all retries/repeats are done
        this.onSequenceCompleted(sequence);

        // No more retries or repeats; mark sequence as complete
        if (group.remaining_incomplete_entries == 0) {
            bun.debugAssert(false); // remaining_incomplete_entries should never go below 0
            return;
        }
        group.remaining_incomplete_entries -= 1;
    }
}
fn onGroupStarted(_: *Execution, _: *ConcurrentGroup, globalThis: *jsc.JSGlobalObject) void {
    const vm = globalThis.bunVM();
    vm.auto_killer.enable();
}
fn onGroupCompleted(_: *Execution, _: *ConcurrentGroup, globalThis: *jsc.JSGlobalObject) void {
    const vm = globalThis.bunVM();
    vm.auto_killer.disable();
}
fn onSequenceStarted(_: *Execution, sequence: *ExecutionSequence) void {
    if (sequence.test_entry) |entry| if (entry.callback == null) return;

    sequence.started_at = bun.timespec.now(.force_real_time);

    if (sequence.test_entry) |entry| {
        log("Running test: \"{f}\"", .{std.zig.fmtString(entry.base.name orelse "(unnamed)")});

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
    if (entry.callback == null) return;

    groupLog.begin(@src());
    defer groupLog.end();
    if (entry.timeout != 0) {
        groupLog.log("-> entry.timeout: {}", .{entry.timeout});
        entry.timespec = bun.timespec.msFromNow(.force_real_time, entry.timeout);
    } else {
        groupLog.log("-> entry.timeout: 0", .{});
        entry.timespec = .epoch;
    }
}
fn onEntryCompleted(_: *Execution, _: *ExecutionEntry) void {}
fn onSequenceCompleted(this: *Execution, sequence: *ExecutionSequence) void {
    const elapsed_ns = if (sequence.started_at.eql(&.epoch)) 0 else sequence.started_at.sinceNow(.force_real_time);
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
    if (sequence.first_entry) |first_entry| if (sequence.test_entry != null or sequence.result != .pass) {
        test_command.CommandLineReporter.handleTestCompleted(this.bunTest(), sequence, sequence.test_entry orelse first_entry, elapsed_ns);
    };

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
    {
        // reset the entries
        var current_entry = sequence.first_entry;
        while (current_entry) |entry| : (current_entry = entry.next) {
            // remove entries that were added in the execution phase
            while (entry.next != null and entry.next.?.added_in_phase == .execution) {
                entry.next = entry.next.?.next;
                // can't deinit the removed entry because it may still be referenced in a RefDataValue
            }
            entry.timespec = .epoch;
        }
    }

    // Preserve the current remaining_repeat_count and remaining_retry_count
    sequence.* = .init(.{
        .first_entry = sequence.first_entry,
        .test_entry = sequence.test_entry,
        .retry_count = sequence.remaining_retry_count,
        .repeat_count = sequence.remaining_repeat_count,
    });
    _ = this;
}

pub fn handleUncaughtException(this: *Execution, user_data: bun_test.BunTest.RefDataValue) bun_test.HandleUncaughtExceptionResult {
    groupLog.begin(@src());
    defer groupLog.end();

    const sequence, const group = this.getCurrentAndValidExecutionSequence(user_data) orelse return .show_unhandled_error_between_tests;
    _ = group;

    sequence.maybe_skip = true;
    if (sequence.active_entry != sequence.test_entry) {
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

const log = bun.Output.scoped(.jest, .visible);

const std = @import("std");
const test_command = @import("../../cli/test_command.zig");

const bun = @import("bun");
const jsc = bun.jsc;

const bun_test = jsc.Jest.bun_test;
const BunTest = bun_test.BunTest;
const Execution = bun_test.Execution;
const ExecutionEntry = bun_test.ExecutionEntry;
const Order = bun_test.Order;
const groupLog = bun_test.debug.group;
