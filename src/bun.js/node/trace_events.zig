const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const json = std.json;

pub const TraceEvents = struct {
    enabled: bool = false,
    categories: []const []const u8 = &.{},
    file: ?std.fs.File = null,
    event_count: usize = 0,
    start_time: i64 = 0,
    vm: *VirtualMachine = undefined,
    allocator: std.mem.Allocator = undefined,
    write_mutex: bun.Mutex = .{},

    const TraceEvent = struct {
        name: []const u8,
        cat: []const u8,
        ph: []const u8, // phase
        pid: i32,
        tid: i32,
        ts: i64, // timestamp in microseconds
        dur: ?i64 = null, // duration for complete events
        args: ?json.ObjectMap = null,
    };

    const TraceFile = struct {
        traceEvents: []const TraceEvent,
        metadata: struct {
            @"node.versions": struct {
                node: []const u8,
                v8: []const u8,
            },
        },
    };

    pub fn init(vm: *VirtualMachine, categories: []const []const u8) !*TraceEvents {
        const allocator = bun.default_allocator;
        var self = try allocator.create(TraceEvents);

        self.* = .{
            .enabled = categories.len > 0,
            .categories = categories,
            .vm = vm,
            .allocator = allocator,
            .start_time = std.time.microTimestamp(),
        };

        if (self.enabled) {
            // Check if any of the categories match "node.environment"
            var has_environment = false;
            for (categories) |cat| {
                if (bun.strings.eql(cat, "node.environment")) {
                    has_environment = true;
                    break;
                }
            }

            if (has_environment) {
                try self.openFile();
            }
        }

        return self;
    }

    fn openFile(self: *TraceEvents) !void {
        const cwd = self.vm.transpiler.options.output_dir orelse try bun.getcwdAlloc(self.allocator);
        defer if (self.vm.transpiler.options.output_dir == null) self.allocator.free(cwd);
        const filename = try std.fmt.allocPrint(self.allocator, "{s}/node_trace.1.log", .{cwd});
        defer self.allocator.free(filename);

        self.file = try std.fs.createFileAbsolute(filename, .{ .truncate = true });

        // Write initial array opening
        _ = try self.file.?.write("{\n");
    }

    pub fn emit(self: *TraceEvents, name: []const u8, cat: []const u8, phase: []const u8) void {
        if (!self.enabled or self.file == null) return;

        self.write_mutex.lock();
        defer self.write_mutex.unlock();

        const ts = std.time.microTimestamp() - self.start_time;
        const pid = @as(i32, @intCast(std.os.getpid()));
        const tid = @as(i32, @intCast(std.Thread.getCurrentId()));

        const event = TraceEvent{
            .name = name,
            .cat = cat,
            .ph = phase,
            .pid = pid,
            .tid = tid,
            .ts = ts,
        };

        self.writeEvent(event) catch {};
        self.event_count += 1;
    }

    fn writeEvent(self: *TraceEvents, event: TraceEvent) !void {
        var buffer: [4096]u8 = undefined;
        var stream = std.io.fixedBufferStream(&buffer);
        const writer = stream.writer();

        if (self.event_count == 0) {
            try writer.writeAll("  \"traceEvents\": [\n");
        } else {
            try writer.writeAll(",\n");
        }

        try writer.writeAll("    {");
        try writer.print("\"name\":\"{s}\",", .{event.name});
        try writer.print("\"cat\":\"{s}\",", .{event.cat});
        try writer.print("\"ph\":\"{s}\",", .{event.ph});
        try writer.print("\"pid\":{d},", .{event.pid});
        try writer.print("\"tid\":{d},", .{event.tid});
        try writer.print("\"ts\":{d}", .{event.ts});
        try writer.writeAll("}");

        _ = try self.file.?.write(stream.getWritten());
    }

    pub fn finalize(self: *TraceEvents) void {
        if (self.file) |file| {
            self.write_mutex.lock();
            defer self.write_mutex.unlock();

            // Close the traceEvents array and add metadata
            const closer =
                \\
                \\  ],
                \\  "metadata": {
                \\    "node.versions": {
                \\      "node": "22.11.0",
                \\      "v8": "12.4.254.14-node.19"
                \\    }
                \\  }
                \\}
            ;
            _ = file.write(closer) catch {};
            file.close();
        }
    }

    pub fn deinit(self: *TraceEvents) void {
        self.finalize();
        self.allocator.destroy(self);
    }
};

// Global trace events instance
var trace_events: ?*TraceEvents = null;

pub fn initialize(vm: *VirtualMachine, categories: []const []const u8) void {
    if (trace_events != null) return;

    trace_events = TraceEvents.init(vm, categories) catch null;
}

pub fn emit(name: []const u8, cat: []const u8, phase: []const u8) void {
    if (trace_events) |events| {
        events.emit(name, cat, phase);
    }
}

pub fn finalize() void {
    if (trace_events) |events| {
        events.deinit();
        trace_events = null;
    }
}

// Convenience functions for common event types
pub fn emitInstant(name: []const u8) void {
    emit(name, "node.environment", "I");
}

pub fn emitComplete(name: []const u8) void {
    emit(name, "node.environment", "X");
}
