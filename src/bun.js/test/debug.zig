pub fn dumpSub(current: TestScheduleEntry) bun.JSError!void {
    switch (current) {
        .describe => |describe| try dumpDescribe(describe),
        .test_callback => |test_callback| try dumpTest(test_callback, "test"),
    }
}
pub fn dumpDescribe(describe: *DescribeScope) bun.JSError!void {
    group.beginMsg("describe {s} (concurrent={}, mode={s}, only={s}, has_callback={})", .{ describe.base.name orelse "undefined", describe.base.concurrent, @tagName(describe.base.mode), @tagName(describe.base.only), describe.base.has_callback });
    defer group.end();

    for (describe.beforeAll.items) |entry| try dumpTest(entry, "beforeAll");
    for (describe.beforeEach.items) |entry| try dumpTest(entry, "beforeEach");
    for (describe.entries.items) |entry| try dumpSub(entry);
    for (describe.afterEach.items) |entry| try dumpTest(entry, "afterEach");
    for (describe.afterAll.items) |entry| try dumpTest(entry, "afterAll");
}
pub fn dumpTest(current: *ExecutionEntry, label: []const u8) bun.JSError!void {
    group.beginMsg("{s} {s} (concurrent={}, only={})", .{ label, current.base.name orelse "undefined", current.base.concurrent, current.base.only });
    defer group.end();
}
pub fn dumpOrder(this: *Execution) bun.JSError!void {
    group.beginMsg("dumpOrder", .{});
    defer group.end();

    for (this.groups, 0..) |group_value, group_index| {
        group.beginMsg("{d} ConcurrentGroup ({d}-{d})", .{ group_index, group_value.sequence_start, group_value.sequence_end });
        defer group.end();

        for (group_value.sequences(this), group_value.sequence_start..) |*sequence, sequence_index| {
            group.beginMsg("{d} Sequence ({d}-{d},{d}x)", .{ sequence_index, sequence.entries_start, sequence.entries_end, sequence.remaining_repeat_count });
            defer group.end();

            for (sequence.entries(this), sequence.entries_start..) |entry, entry_index| {
                group.log("{d} ExecutionEntry \"{}\" (concurrent={}, mode={s}, only={s}, has_callback={})", .{ entry_index, std.zig.fmtEscapes(entry.base.name orelse "undefined"), entry.base.concurrent, @tagName(entry.base.mode), @tagName(entry.base.only), entry.base.has_callback });
            }
        }
    }
}

pub const group = struct {
    fn printIndent() void {
        std.io.getStdOut().writer().print("\x1b[90m", .{}) catch {};
        for (0..indent) |_| {
            std.io.getStdOut().writer().print("│ ", .{}) catch {};
        }
        std.io.getStdOut().writer().print("\x1b[m", .{}) catch {};
    }
    var indent: usize = 0;
    var last_was_start = false;
    var wants_quiet: ?bool = null;
    fn getWantsQuiet() bool {
        if (wants_quiet) |v| return v;
        if (bun.getenvZ("WANTS_QUIET")) |val| {
            if (!std.mem.eql(u8, val, "0")) {
                wants_quiet = true;
                return wants_quiet.?;
            }
        }
        wants_quiet = false;
        return wants_quiet.?;
    }
    pub fn begin(pos: std.builtin.SourceLocation) void {
        return beginMsg("\x1b[36m{s}\x1b[37m:\x1b[93m{d}\x1b[37m:\x1b[33m{d}\x1b[37m: \x1b[35m{s}\x1b[m", .{ pos.file, pos.line, pos.column, pos.fn_name });
    }
    pub fn beginMsg(comptime fmtt: []const u8, args: anytype) void {
        if (getWantsQuiet()) return;
        printIndent();
        std.io.getStdOut().writer().print("\x1b[32m++ \x1b[0m", .{}) catch {};
        std.io.getStdOut().writer().print(fmtt ++ "\n", args) catch {};
        indent += 1;
        last_was_start = true;
    }
    pub fn end() void {
        if (getWantsQuiet()) return;
        indent -= 1;
        defer last_was_start = false;
        if (last_was_start) return; //std.io.getStdOut().writer().print("\x1b[A", .{}) catch {};
        printIndent();
        std.io.getStdOut().writer().print("\x1b[32m{s}\x1b[m\n", .{if (last_was_start) "+-" else "--"}) catch {};
    }
    pub fn log(comptime fmtt: []const u8, args: anytype) void {
        if (getWantsQuiet()) return;
        printIndent();
        std.io.getStdOut().writer().print(fmtt ++ "\n", args) catch {};
        last_was_start = false;
    }
};

const bun = @import("bun");
const std = @import("std");

const describe2 = @import("./describe2.zig");
const DescribeScope = describe2.DescribeScope;
const Execution = describe2.Execution;
const ExecutionEntry = describe2.ExecutionEntry;
const TestScheduleEntry = describe2.TestScheduleEntry;
