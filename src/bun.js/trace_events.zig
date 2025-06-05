const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const strings = bun.strings;
const Output = bun.Output;

pub const TraceEvents = struct {
    enabled: bool = false,
    categories: []const u8 = "",
    events: std.ArrayList(Event) = undefined,
    start_time: i64 = 0,

    const Event = struct {
        name: []const u8,
        cat: []const u8,
        ph: u8,
        pid: i32,
        tid: i32,
        ts: u64,

        pub fn jsonStringify(self: Event, writer: anytype) !void {
            try writer.beginObject();
            try writer.objectField("name");
            try writer.write(self.name);
            try writer.objectField("cat");
            try writer.write(self.cat);
            try writer.objectField("ph");
            try writer.writeByte(self.ph);
            try writer.objectField("pid");
            try writer.write(self.pid);
            try writer.objectField("tid");
            try writer.write(self.tid);
            try writer.objectField("ts");
            try writer.write(self.ts);
            try writer.endObject();
        }
    };

    pub fn init(allocator: std.mem.Allocator, categories: []const u8) TraceEvents {
        const enabled = categories.len > 0;
        return .{
            .enabled = enabled,
            .categories = categories,
            .events = if (enabled) std.ArrayList(Event).init(allocator) else undefined,
            .start_time = if (enabled) std.time.microTimestamp() else 0,
        };
    }

    pub fn deinit(self: *TraceEvents) void {
        if (self.enabled) {
            self.events.deinit();
        }
    }

    pub fn addEvent(self: *TraceEvents, name: []const u8, cat: []const u8, phase: u8) !void {
        if (!self.enabled) return;
        if (!strings.contains(self.categories, cat) and !strings.eqlComptime(self.categories, "node.environment")) return;

        const ts = std.time.microTimestamp() - self.start_time;
        try self.events.append(.{
            .name = name,
            .cat = cat,
            .ph = phase,
            .pid = @intCast(std.process.pid()),
            .tid = @intCast(std.Thread.getCurrentId()),
            .ts = @intCast(@max(0, ts)),
        });
    }

    pub fn writeToFile(self: *TraceEvents, dir_path: []const u8) !void {
        if (!self.enabled) return;

        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const filename = try std.fmt.bufPrintZ(&buf, "{s}/node_trace.1.log", .{dir_path});

        std.io.getStdErr().writer().print("TRACE: Writing trace events to: {s} ({} events)\n", .{ filename, self.events.items.len }) catch {};

        const file = try std.fs.createFileAbsolute(filename, .{});
        defer file.close();

        var writer = file.writer();

        try writer.writeAll("{\"traceEvents\":[");

        // Write metadata event
        try writer.writeAll("{\"pid\":");
        try writer.print("{d}", .{std.process.pid()});
        try writer.writeAll(",\"tid\":");
        try writer.print("{d}", .{std.Thread.getCurrentId()});
        try writer.writeAll(",\"ts\":0,\"ph\":\"M\",\"cat\":\"__metadata\",\"name\":\"process_name\",\"args\":{\"name\":\"node\"}}");

        for (self.events.items) |event| {
            try writer.writeByte(',');
            try std.json.stringify(event, .{}, writer);
        }

        try writer.writeAll("]}");
    }
};

var global_trace_events: TraceEvents = undefined;
var initialized = false;

pub fn initialize(allocator: std.mem.Allocator, categories: []const u8) void {
    std.io.getStdErr().writer().print("TRACE: trace_events.initialize called with categories: {s}\n", .{categories}) catch {};
    if (!initialized) {
        global_trace_events = TraceEvents.init(allocator, categories);
        initialized = true;

        if (global_trace_events.enabled) {
            std.io.getStdErr().writer().print("TRACE: Trace events enabled with categories: {s}\n", .{categories}) catch {};
            // Add initial environment events
            addEnvironmentEvent("Environment", 'B') catch {};
        }
    }
}

pub fn addEnvironmentEvent(name: []const u8, phase: u8) !void {
    if (initialized) {
        try global_trace_events.addEvent(name, "node.environment", phase);
    }
}

pub fn flush(dir_path: []const u8) void {
    if (initialized and global_trace_events.enabled) {
        std.io.getStdErr().writer().print("TRACE: Flushing trace events to dir: {s}\n", .{dir_path}) catch {};
        global_trace_events.writeToFile(dir_path) catch |err| {
            std.io.getStdErr().writer().print("TRACE: Failed to write trace events: {s}\n", .{@errorName(err)}) catch {};
        };
    }
}

pub fn deinit() void {
    if (initialized) {
        global_trace_events.deinit();
        initialized = false;
    }
}
