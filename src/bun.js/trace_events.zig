const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const strings = bun.strings;

const TraceName = enum {
    Environment,
    RunAndClearNativeImmediates,
    CheckImmediate,
    RunTimers,
    BeforeExit,
    RunCleanup,
    AtExit,
};

pub const TraceEvents = struct {
    enabled: bool = false,
    categories: []const u8 = "",
    file: ?std.fs.File = null,
    start_time: i64 = 0,
    mutex: bun.Mutex = .{},
    pid: std.posix.pid_t = 0,
    first_event: bool = true,

    pub fn init(vm: *JSC.VirtualMachine) !void {
        const categories = vm.trace_event_categories orelse return;

        // Check if node.environment is in the categories
        if (!strings.contains(categories, "node.environment")) {
            return;
        }

        var trace_events = try vm.allocator.create(TraceEvents);
        trace_events.* = .{
            .enabled = true,
            .categories = categories,
            .start_time = std.time.microTimestamp(),
            .pid = std.posix.getpid(),
        };

        // Open trace file
        const file = try std.fs.cwd().createFile("node_trace.1.log", .{});
        trace_events.file = file;

        // Write initial JSON array opening
        _ = try file.writeAll("{\"traceEvents\":[\n");

        // Write metadata event
        try trace_events.writeMetadataEvent();

        vm.trace_events = trace_events;
    }

    pub fn deinit(this: *TraceEvents) void {
        if (this.file) |file| {
            // Close JSON array
            _ = file.writeAll("\n]}\n") catch {};
            file.close();
        }
    }

    fn writeMetadataEvent(this: *TraceEvents) !void {
        if (this.file) |file| {
            const metadata = "{\"pid\":{d},\"tid\":0,\"ts\":0,\"ph\":\"M\",\"cat\":\"__metadata\",\"name\":\"process_name\",\"args\":{{\"name\":\"bun\"}}}";
            var buf: [256]u8 = undefined;
            const result = try std.fmt.bufPrint(&buf, metadata, .{this.pid});
            _ = try file.writeAll(result);
            this.first_event = false;
        }
    }

    pub fn emit(this: *TraceEvents, name: TraceName, phase: []const u8) void {
        if (!this.enabled) return;

        this.mutex.lock();
        defer this.mutex.unlock();

        const now = std.time.microTimestamp();
        const ts = now - this.start_time;

        this.writeEvent(name, phase, ts) catch {};
    }

    fn writeEvent(this: *TraceEvents, name: TraceName, phase: []const u8, ts: i64) !void {
        if (this.file) |file| {
            var buf: [512]u8 = undefined;

            // Write comma if not first event
            if (!this.first_event) {
                _ = try file.writeAll(",\n");
            } else {
                this.first_event = false;
            }

            // Format the event
            const fmt = "{{\"pid\":{d},\"tid\":0,\"ts\":{d},\"ph\":\"{s}\",\"cat\":\"node,node.environment\",\"name\":\"{s}\"}}";
            const result = try std.fmt.bufPrint(&buf, fmt, .{
                this.pid,
                ts,
                phase,
                @tagName(name),
            });

            _ = try file.writeAll(result);
        }
    }
};

// Export functions to be called from other parts of the VM
pub fn emitTraceEvent(vm: *JSC.VirtualMachine, name: TraceName) void {
    if (vm.trace_events) |trace_events| {
        trace_events.emit(name, "X");
    }
}

pub fn emitTraceEventBegin(vm: *JSC.VirtualMachine, name: TraceName) void {
    if (vm.trace_events) |trace_events| {
        trace_events.emit(name, "B");
    }
}

pub fn emitTraceEventEnd(vm: *JSC.VirtualMachine, name: TraceName) void {
    if (vm.trace_events) |trace_events| {
        trace_events.emit(name, "E");
    }
}
