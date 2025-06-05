const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const Output = bun.Output;

pub const TraceEvents = struct {
    enabled: bool = false,
    categories: []const u8 = "",
    pid: u32,
    events: std.ArrayList(TraceEvent) = undefined,
    allocator: std.mem.Allocator,

    pub const TraceEvent = struct {
        cat: []const u8,
        name: []const u8,
        pid: u32,
        tid: u32,
        ts: u64,
        ph: u8, // phase: 'B' for begin, 'E' for end
        args: struct {},
    };

    pub fn init(allocator: std.mem.Allocator, categories: []const u8) TraceEvents {
        const pid = if (bun.Environment.isWindows)
            std.os.windows.kernel32.GetCurrentProcessId()
        else
            std.os.linux.getpid();

        return .{
            .enabled = categories.len > 0,
            .categories = categories,
            .pid = @intCast(pid),
            .events = std.ArrayList(TraceEvent).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn addEvent(this: *TraceEvents, name: []const u8, cat: []const u8) void {
        if (!this.enabled) return;
        if (!bun.strings.contains(this.categories, cat)) return;

        const now = std.time.microTimestamp();
        const tid = if (bun.Environment.isWindows)
            std.os.windows.kernel32.GetCurrentThreadId()
        else
            std.Thread.getCurrentId();

        this.events.append(.{
            .cat = cat,
            .name = name,
            .pid = this.pid,
            .tid = @truncate(tid),
            .ts = @intCast(now),
            .ph = 'X', // complete event
            .args = .{},
        }) catch {};
    }

    pub fn writeToFile(this: *TraceEvents, _: []const u8) !void {
        if (!this.enabled) return;
        if (this.events.items.len == 0) return;

        // Write to current working directory like Node.js does
        const file = try std.fs.cwd().createFile("node_trace.1.log", .{});
        defer file.close();

        const writer = file.writer();
        try writer.writeAll("{\"traceEvents\":[");

        for (this.events.items, 0..) |event, i| {
            if (i > 0) try writer.writeAll(",");

            try writer.print(
                \\{{
                \\  "cat": "{s}",
                \\  "name": "{s}",
                \\  "ph": "{c}",
                \\  "pid": {d},
                \\  "tid": {d},
                \\  "ts": {d},
                \\  "args": {{}}
                \\}}
            , .{
                event.cat,
                event.name,
                event.ph,
                event.pid,
                event.tid,
                event.ts,
            });
        }

        try writer.writeAll("]}");
    }

    pub fn deinit(this: *TraceEvents) void {
        this.events.deinit();
    }
};
