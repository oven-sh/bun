pub fn dumpSub(current: TestScheduleEntry) bun.JSError!void {
    switch (current) {
        .describe => |describe| try dumpDescribe(describe),
        .test_callback => |test_callback| try dumpTest(test_callback),
    }
}
pub fn dumpDescribe(describe: *DescribeScope) bun.JSError!void {
    groupLog.beginMsg("describe {s} (concurrent={}, filter={s}, only={s})", .{ describe.name orelse "undefined", describe.concurrent, @tagName(describe.filter), @tagName(describe.only) });
    defer groupLog.end();

    for (describe.beforeAll.items) |entry| try dumpTest(entry);
    for (describe.beforeEach.items) |entry| try dumpTest(entry);
    for (describe.entries.items) |entry| try dumpSub(entry);
    for (describe.afterEach.items) |entry| try dumpTest(entry);
    for (describe.afterAll.items) |entry| try dumpTest(entry);
}
pub fn dumpTest(current: *ExecutionEntry) bun.JSError!void {
    groupLog.beginMsg("test {s} / {s} (concurrent={}, only={})", .{ @tagName(current.tag), current.name orelse "undefined", current.concurrent, current.only });
    defer groupLog.end();
}
pub fn dumpOrder(this: *Execution) bun.JSError!void {
    groupLog.beginMsg("dumpOrder", .{});
    defer groupLog.end();

    for (this.order.items, 0..) |group, group_index| {
        groupLog.beginMsg("{d}: ConcurrentGroup {d}-{d}", .{ group_index, group.sequence_start, group.sequence_end });
        defer groupLog.end();

        for (group.sequence_start..group.sequence_end) |sequence_index| {
            const sequence = &this._sequences.items[sequence_index];
            groupLog.beginMsg("{d}: Sequence {d}-{d}", .{ sequence_index, sequence.entry_start, sequence.entry_end });
            defer groupLog.end();

            for (sequence.entry_start..sequence.entry_end) |entry_index| {
                const entry = this._entries.items[entry_index];
                groupLog.log("{d}: ExecutionEntry {d}: {s} / {s}", .{ entry_index, entry_index, @tagName(entry.tag), entry.name orelse "undefined" });
            }
        }
    }
}

const bun = @import("bun");

const describe2 = @import("./describe2.zig");
const DescribeScope = describe2.DescribeScope;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const TestScheduleEntry = describe2.TestScheduleEntry;
const groupLog = describe2.group;
