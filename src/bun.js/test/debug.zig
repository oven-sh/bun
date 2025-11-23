pub fn dumpSub(current: TestScheduleEntry) bun.JSError!void {
    if (!group.getLogEnabled()) return;
    switch (current) {
        .describe => |describe| try dumpDescribe(describe),
        .test_callback => |test_callback| try dumpTest(test_callback, "test"),
    }
}
pub fn dumpDescribe(describe: *DescribeScope) bun.JSError!void {
    if (!group.getLogEnabled()) return;
    group.beginMsg("describe \"{f}\" (concurrent={}, mode={s}, only={s}, has_callback={})", .{ std.zig.fmtString(describe.base.name orelse "(unnamed)"), describe.base.concurrent, @tagName(describe.base.mode), @tagName(describe.base.only), describe.base.has_callback });
    defer group.end();

    for (describe.beforeAll.items) |entry| try dumpTest(entry, "beforeAll");
    for (describe.beforeEach.items) |entry| try dumpTest(entry, "beforeEach");
    for (describe.entries.items) |entry| try dumpSub(entry);
    for (describe.afterEach.items) |entry| try dumpTest(entry, "afterEach");
    for (describe.afterAll.items) |entry| try dumpTest(entry, "afterAll");
}
pub fn dumpTest(current: *ExecutionEntry, label: []const u8) bun.JSError!void {
    if (!group.getLogEnabled()) return;
    group.beginMsg("{s} \"{f}\" (concurrent={}, only={})", .{ label, std.zig.fmtString(current.base.name orelse "(unnamed)"), current.base.concurrent, current.base.only });
    defer group.end();
}
pub fn dumpOrder(this: *Execution) bun.JSError!void {
    if (!group.getLogEnabled()) return;
    group.beginMsg("dumpOrder", .{});
    defer group.end();

    for (this.groups, 0..) |group_value, group_index| {
        group.beginMsg("{d} ConcurrentGroup ({d}-{d})", .{ group_index, group_value.sequence_start, group_value.sequence_end });
        defer group.end();

        for (group_value.sequences(this), 0..) |*sequence, sequence_index| {
            group.beginMsg("{d} Sequence ({d}x)", .{ sequence_index, sequence.remaining_repeat_count });
            defer group.end();

            var current_entry = sequence.first_entry;
            while (current_entry) |entry| : (current_entry = entry.next) {
                group.log("ExecutionEntry \"{f}\" (concurrent={}, mode={s}, only={s}, has_callback={})", .{ std.zig.fmtString(entry.base.name orelse "(unnamed)"), entry.base.concurrent, @tagName(entry.base.mode), @tagName(entry.base.only), entry.base.has_callback });
            }
        }
    }
}

pub const group = struct {
    fn printIndent(writer: *std.Io.Writer) void {
        writer.print("\x1b[90m", .{}) catch {};
        for (0..indent) |_| {
            writer.print("│ ", .{}) catch {};
        }
        writer.print("\x1b[m", .{}) catch {};
    }
    var indent: usize = 0;
    var last_was_start = false;
    fn getLogEnabledRuntime() bool {
        return bun.env_var.WANTS_LOUD.get();
    }
    inline fn getLogEnabledStaticFalse() bool {
        return false;
    }
    pub const getLogEnabled = if (!bun.Environment.enable_logs) getLogEnabledStaticFalse else getLogEnabledRuntime;
    pub fn begin(pos: std.builtin.SourceLocation) void {
        return beginMsg("\x1b[36m{s}\x1b[37m:\x1b[93m{d}\x1b[37m:\x1b[33m{d}\x1b[37m: \x1b[35m{s}\x1b[m", .{ pos.file, pos.line, pos.column, pos.fn_name });
    }
    pub fn beginMsg(comptime fmtt: []const u8, args: anytype) void {
        if (!getLogEnabled()) return;

        var buf: [64]u8 = undefined;
        var writer = std.fs.File.stdout().writerStreaming(&buf);

        printIndent(&writer.interface);
        writer.interface.print("\x1b[32m++ \x1b[0m", .{}) catch {};
        writer.interface.print(fmtt ++ "\n", args) catch {};
        writer.interface.flush() catch {};
        indent += 1;
        last_was_start = true;
    }
    pub fn end() void {
        if (!getLogEnabled()) return;
        indent -= 1;
        defer last_was_start = false;
        if (last_was_start) return; //std.fs.File.stdout().writer().print("\x1b[A", .{}) catch {};

        var buf: [64]u8 = undefined;
        var writer = std.fs.File.stdout().writerStreaming(&buf);
        printIndent(&writer.interface);
        writer.interface.print("\x1b[32m{s}\x1b[m\n", .{if (last_was_start) "+-" else "--"}) catch {};
        writer.interface.flush() catch {};
    }
    pub fn log(comptime fmtt: []const u8, args: anytype) void {
        if (!getLogEnabled()) return;
        var buf: [64]u8 = undefined;
        var writer = std.fs.File.stdout().writerStreaming(&buf);
        printIndent(&writer.interface);
        writer.interface.print(fmtt ++ "\n", args) catch {};
        writer.interface.flush() catch {};
        last_was_start = false;
    }
};

const bun = @import("bun");
const std = @import("std");

const bun_test = @import("./bun_test.zig");
const DescribeScope = bun_test.DescribeScope;
const Execution = bun_test.Execution;
const ExecutionEntry = bun_test.ExecutionEntry;
const TestScheduleEntry = bun_test.TestScheduleEntry;
