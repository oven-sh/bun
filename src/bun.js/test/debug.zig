pub fn dumpSub(current: TestScheduleEntry) bun.JSError!void {
    switch (current) {
        .describe => |describe| try dumpDescribe(describe),
        .test_callback => |test_callback| try dumpTest(test_callback, "test"),
    }
}
pub fn dumpDescribe(describe: *DescribeScope) bun.JSError!void {
    groupLog.beginMsg("describe {s} (concurrent={}, mode={s}, only={s})", .{ describe.base.name orelse "undefined", describe.base.concurrent, @tagName(describe.base.mode), @tagName(describe.base.only) });
    defer groupLog.end();

    for (describe.beforeAll.items) |entry| try dumpTest(entry, "beforeAll");
    for (describe.beforeEach.items) |entry| try dumpTest(entry, "beforeEach");
    for (describe.entries.items) |entry| try dumpSub(entry);
    for (describe.afterEach.items) |entry| try dumpTest(entry, "afterEach");
    for (describe.afterAll.items) |entry| try dumpTest(entry, "afterAll");
}
pub fn dumpTest(current: *ExecutionEntry, label: []const u8) bun.JSError!void {
    groupLog.beginMsg("{s} {s} (concurrent={}, only={})", .{ label, current.base.name orelse "undefined", current.base.concurrent, current.base.only });
    defer groupLog.end();
}
pub fn dumpOrder(this: *Execution) bun.JSError!void {
    groupLog.beginMsg("dumpOrder", .{});
    defer groupLog.end();

    for (this.groups, 0..) |group, group_index| {
        groupLog.beginMsg("{d} ConcurrentGroup ({d}-{d})", .{ group_index, group.@"#sequence_start", group.@"#sequence_end" });
        defer groupLog.end();

        for (group.sequences(this), group.@"#sequence_start"..) |*sequence, sequence_index| {
            groupLog.beginMsg("{d} Sequence ({d}-{d},{d}x)", .{ sequence_index, sequence.@"#entries_start", sequence.@"#entries_end", sequence.remaining_repeat_count });
            defer groupLog.end();

            for (sequence.entries(this), sequence.@"#entries_start"..) |entry, entry_index| {
                groupLog.log("{d} ExecutionEntry \"{}\" (concurrent={}, mode={s}, only={s})", .{ entry_index, std.zig.fmtEscapes(entry.base.name orelse "undefined"), entry.base.concurrent, @tagName(entry.base.mode), @tagName(entry.base.only) });
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
