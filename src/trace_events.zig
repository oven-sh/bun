const std = @import("std");
const bun = @import("bun");
const Output = bun.Output;
const JSC = bun.JSC;

pub const TraceEventPhase = enum(u8) {
    Begin = 'B',
    End = 'E',
    Complete = 'X',
    Instant = 'I',
    AsyncBegin = 'b',
    AsyncEnd = 'e',
    Metadata = 'M',
};

pub const TraceEvent = struct {
    name: []const u8,
    cat: []const u8,
    ph: TraceEventPhase,
    pid: i32,
    tid: i32,
    ts: i64,
    dur: ?i64 = null,
    args: ?std.json.Value = null,
};

pub const TraceEventCollector = struct {
    events: std.ArrayList(TraceEvent),
    allocator: std.mem.Allocator,
    enabled_categories: []const u8,
    process_id: i32,
    thread_id: i32,
    file_handle: ?std.fs.File = null,
    mutex: std.Thread.Mutex = .{},

    const Self = @This();

    pub fn init(allocator: std.mem.Allocator, categories: []const u8) !*Self {
        var self = try allocator.create(Self);
        self.* = .{
            .events = std.ArrayList(TraceEvent).init(allocator),
            .allocator = allocator,
            .enabled_categories = categories,
            .process_id = std.c.getpid(),
            .thread_id = @intCast(std.c.gettid()),
        };

        // Open the trace file
        if (categories.len > 0) {
            self.file_handle = try std.fs.cwd().createFile("node_trace.1.log", .{ .truncate = true });

            // Write the initial metadata event
            try self.writeHeader();
        }

        return self;
    }

    pub fn deinit(self: *Self) void {
        if (self.file_handle) |file| {
            self.writeFooter() catch {};
            file.close();
        }
        self.events.deinit();
        self.allocator.destroy(self);
    }

    fn writeHeader(self: *Self) !void {
        if (self.file_handle) |file| {
            try file.writeAll("{\"traceEvents\":[\n");

            // Write metadata event
            const metadata = TraceEvent{
                .name = "process_name",
                .cat = "__metadata",
                .ph = .Metadata,
                .pid = self.process_id,
                .tid = self.thread_id,
                .ts = 0,
                .args = std.json.Value{ .object = std.json.ObjectMap.init(self.allocator) },
            };

            try self.writeEvent(file, metadata, false);
        }
    }

    fn writeFooter(self: *Self) !void {
        if (self.file_handle) |file| {
            try file.writeAll("\n]}");
        }
    }

    fn writeEvent(_: *Self, file: std.fs.File, event: TraceEvent, needs_comma: bool) !void {
        if (needs_comma) {
            try file.writeAll(",\n");
        }

        try file.writeAll("{");
        try std.fmt.format(file.writer(), "\"name\":\"{s}\",\"cat\":\"{s}\",\"ph\":\"{c}\",\"pid\":{d},\"tid\":{d},\"ts\":{d}", .{
            event.name,
            event.cat,
            @intFromEnum(event.ph),
            event.pid,
            event.tid,
            event.ts,
        });

        if (event.dur) |dur| {
            try std.fmt.format(file.writer(), ",\"dur\":{d}", .{dur});
        }

        if (event.args) |args| {
            try file.writeAll(",\"args\":");
            try std.json.stringify(args, .{}, file.writer());
        }

        try file.writeAll("}");
    }

    pub fn emit(self: *Self, name: []const u8, category: []const u8, phase: TraceEventPhase) !void {
        if (!self.isEnabled(category)) return;

        self.mutex.lock();
        defer self.mutex.unlock();

        const now = std.time.microTimestamp();
        const event = TraceEvent{
            .name = name,
            .cat = category,
            .ph = phase,
            .pid = self.process_id,
            .tid = @intCast(std.c.gettid()),
            .ts = now,
        };

        if (self.file_handle) |file| {
            try self.writeEvent(file, event, self.events.items.len > 0);
        }

        try self.events.append(event);
    }

    pub fn emitComplete(self: *Self, name: []const u8, category: []const u8, duration_us: i64) !void {
        if (!self.isEnabled(category)) return;

        self.mutex.lock();
        defer self.mutex.unlock();

        const now = std.time.microTimestamp();
        const event = TraceEvent{
            .name = name,
            .cat = category,
            .ph = .Complete,
            .pid = self.process_id,
            .tid = @intCast(std.c.gettid()),
            .ts = now - duration_us,
            .dur = duration_us,
        };

        if (self.file_handle) |file| {
            try self.writeEvent(file, event, self.events.items.len > 0);
        }

        try self.events.append(event);
    }

    fn isEnabled(self: *Self, category: []const u8) bool {
        if (self.enabled_categories.len == 0) return false;

        // Check if the category is in the enabled list
        var it = std.mem.tokenize(u8, self.enabled_categories, ",");
        while (it.next()) |enabled_cat| {
            if (std.mem.eql(u8, enabled_cat, category)) {
                return true;
            }
        }

        return false;
    }
};

var global_trace_collector: ?*TraceEventCollector = null;

pub fn init(allocator: std.mem.Allocator, categories: []const u8) !void {
    if (categories.len == 0) return;

    global_trace_collector = try TraceEventCollector.init(allocator, categories);
}

pub fn deinit() void {
    if (global_trace_collector) |collector| {
        collector.deinit();
        global_trace_collector = null;
    }
}

pub fn emit(name: []const u8, category: []const u8, phase: TraceEventPhase) void {
    if (global_trace_collector) |collector| {
        collector.emit(name, category, phase) catch {};
    }
}

pub fn emitComplete(name: []const u8, category: []const u8, duration_us: i64) void {
    if (global_trace_collector) |collector| {
        collector.emitComplete(name, category, duration_us) catch {};
    }
}

// Helper struct for measuring duration
pub const TraceTimer = struct {
    name: []const u8,
    category: []const u8,
    start_time: i64,

    pub fn begin(name: []const u8, category: []const u8) TraceTimer {
        emit(name, category, .Begin);
        return .{
            .name = name,
            .category = category,
            .start_time = std.time.microTimestamp(),
        };
    }

    pub fn end(self: TraceTimer) void {
        const duration = std.time.microTimestamp() - self.start_time;
        emitComplete(self.name, self.category, duration);
    }
};
