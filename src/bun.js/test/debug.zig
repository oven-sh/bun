pub fn dumpSub(current: TestScheduleEntry) bun.JSError!void {
    switch (current) {
        .describe => |describe| try dumpDescribe(describe),
        .test_callback => |test_callback| try dumpTest(test_callback),
    }
}
pub fn dumpDescribe(describe: *DescribeScope) bun.JSError!void {
    groupLog.beginMsg("describe {s} (concurrent={}, filter={s}, only={s})", .{ describe.base.name orelse "undefined", describe.base.concurrent, @tagName(describe.base.filter), @tagName(describe.base.only) });
    defer groupLog.end();

    for (describe.beforeAll.items) |entry| try dumpTest(entry);
    for (describe.beforeEach.items) |entry| try dumpTest(entry);
    for (describe.entries.items) |entry| try dumpSub(entry);
    for (describe.afterEach.items) |entry| try dumpTest(entry);
    for (describe.afterAll.items) |entry| try dumpTest(entry);
}
pub fn dumpTest(current: *ExecutionEntry) bun.JSError!void {
    groupLog.beginMsg("test {s} (concurrent={}, only={})", .{ current.base.name orelse "undefined", current.base.concurrent, current.base.only });
    defer groupLog.end();
}
pub fn dumpOrder(this: *Execution) bun.JSError!void {
    groupLog.beginMsg("dumpOrder", .{});
    defer groupLog.end();

    for (this.groups, 0..) |group, group_index| {
        groupLog.beginMsg("{d}: ConcurrentGroup {d}-{d}", .{ group_index, group.sequence_start, group.sequence_end });
        defer groupLog.end();

        for (group.sequences(this)) |*sequence| {
            groupLog.beginMsg("Sequence {d}-{d} ({d}x)", .{ sequence.entry_start, sequence.entry_end, sequence.remaining_repeat_count });
            defer groupLog.end();

            for (sequence.entries(this)) |entry| {
                groupLog.log("ExecutionEntry \"{}\" (concurrent={}, mode={s}, only={s}, filter={s})", .{ std.zig.fmtEscapes(entry.base.name orelse "undefined"), entry.base.concurrent, @tagName(entry.base.mode), @tagName(entry.base.only), @tagName(entry.base.filter) });
            }
        }
    }
}

const bun = @import("bun");
const std = @import("std");

const describe2 = @import("./describe2.zig");
const DescribeScope = describe2.DescribeScope;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const TestScheduleEntry = describe2.TestScheduleEntry;
const groupLog = describe2.group;
