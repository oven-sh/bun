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

fn bunTest(this: *Execution) *BunTestFile {
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
            while (true) {
                groupLog.begin(@src());
                defer groupLog.end();

                const sequence = &this._sequences.items[sequence_index];
                if (sequence.executing) {
                    groupLog.log("runOne: can't advance; already executing", .{});
                    status = .execute; // can't advance; already executing
                    break;
                }
                if (sequence.entry_index >= sequence.entry_end) {
                    groupLog.log("runOne: sequence completed; decrement repeat count", .{});
                    this.onSequenceCompleted(sequence_index);
                    sequence.remaining_repeat_count -= 1;
                    if (sequence.remaining_repeat_count <= 0) {
                        groupLog.log("runOne: no repeats left; wait for group completion.", .{});
                        break; // done
                    }
                    this.resetSequence(sequence_index);
                }

                const next_item = this._entries.items[sequence.entry_index];
                sequence.executing = true;
                this.onSequenceStarted(sequence_index);

                if (next_item.callback.get()) |cb| {
                    groupLog.log("runSequence queued callback for sequence_index {d} (entry_index {d})", .{ sequence_index, sequence.entry_index });
                    try callback_queue.append(.{ .callback = .init(this.bunTest().gpa, cb), .done_parameter = true, .data = sequence_index });
                    status = .execute;
                    break;
                } else switch (next_item.tag) {
                    .skip => {
                        sequence.executing = false;
                        sequence.entry_index += 1;
                        if (sequence.result == .pending) sequence.result = .skip;
                        continue;
                    },
                    .todo => {
                        sequence.executing = false;
                        sequence.entry_index += 1;
                        if (sequence.result == .pending) sequence.result = .todo;
                        continue;
                    },
                    else => {
                        groupLog.log("runSequence: no callback for sequence_index {d} (entry_index {d})", .{ sequence_index, sequence.entry_index });
                        bun.debugAssert(false);
                        sequence.executing = false;
                        sequence.entry_index += 1;
                        continue;
                    },
                }
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
    test_command.CommandLineReporter.handleTestCompleted(this.bunTest(), sequence, sequence.test_entry orelse return, elapsed_ns);
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

const std = @import("std");
const test_command = @import("../../cli/test_command.zig");

const describe2 = @import("./describe2.zig");
const BunTestFile = describe2.BunTestFile;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const groupLog = describe2.group;

const bun = @import("bun");
const jsc = bun.jsc;
