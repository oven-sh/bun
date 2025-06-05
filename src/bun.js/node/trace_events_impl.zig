const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;

extern "c" fn getpid() c_int;

pub const TraceEvents = struct {
    enabled: bool = false,
    categories: []const u8 = "",
    file: ?std.fs.File = null,
    start_time: i64 = 0,
    process_id: i32 = 0,
    first_event: bool = true,

    pub fn init(categories: []const u8) !TraceEvents {
        if (categories.len == 0) {
            return TraceEvents{};
        }

        // Create trace file in current directory
        const file = try std.fs.cwd().createFile("node_trace.1.log", .{});

        var self = TraceEvents{
            .enabled = true,
            .categories = categories,
            .file = file,
            .start_time = std.time.microTimestamp(),
            .process_id = @intCast(getpid()),
            .first_event = true,
        };

        // Write initial trace event format header
        try self.writeHeader();

        return self;
    }

    fn writeHeader(self: *TraceEvents) !void {
        const file = self.file orelse return;
        try file.writeAll("{\"traceEvents\":[");
    }

    pub fn deinit(self: *TraceEvents) void {
        if (self.file) |file| {
            // Write closing bracket
            file.writeAll("\n]}\n") catch {};
            file.close();
            self.file = null;
        }
    }

    pub fn emit(
        self: *TraceEvents,
        name: []const u8,
        phase: u8,
        timestamp: ?i64,
    ) void {
        if (!self.enabled) return;
        const file = self.file orelse return;

        const ts = timestamp orelse (std.time.microTimestamp() - self.start_time);

        // Write comma if not first event
        if (!self.first_event) {
            file.writeAll(",") catch return;
        } else {
            self.first_event = false;
        }

        // Write trace event in Chrome trace format
        var buf: [1024]u8 = undefined;
        const event = std.fmt.bufPrint(&buf,
            \\\n{{"name":"{s}","cat":"node.environment","ph":"{c}","pid":{},"tid":1,"ts":{}}}
        , .{
            name,
            phase,
            self.process_id,
            ts,
        }) catch return;

        file.writeAll(event) catch return;
    }

    pub fn emitInstant(self: *TraceEvents, name: []const u8) void {
        self.emit(name, 'I', null);
    }

    pub fn emitBegin(self: *TraceEvents, name: []const u8) void {
        self.emit(name, 'B', null);
    }

    pub fn emitEnd(self: *TraceEvents, name: []const u8) void {
        self.emit(name, 'E', null);
    }
};

// Global instance
var trace_events: ?TraceEvents = null;

pub fn init(categories: []const u8) void {
    if (trace_events != null) return;

    trace_events = TraceEvents.init(categories) catch {
        // Silently fail if we can't create trace file
        return;
    };
}

pub fn deinit() void {
    if (trace_events) |*te| {
        te.deinit();
        trace_events = null;
    }
}

pub fn emit(name: []const u8, phase: u8) void {
    if (trace_events) |*te| {
        te.emit(name, phase, null);
    }
}

pub fn emitInstant(name: []const u8) void {
    if (trace_events) |*te| {
        te.emitInstant(name);
    }
}

pub fn emitBegin(name: []const u8) void {
    if (trace_events) |*te| {
        te.emitBegin(name);
    }
}

pub fn emitEnd(name: []const u8) void {
    if (trace_events) |*te| {
        te.emitEnd(name);
    }
}

// Emit environment lifecycle events
pub fn emitEnvironment() void {
    emitInstant("Environment");
}

pub fn emitRunTimers() void {
    emitInstant("RunTimers");
}

pub fn emitCheckImmediate() void {
    emitInstant("CheckImmediate");
}

pub fn emitRunAndClearNativeImmediates() void {
    emitInstant("RunAndClearNativeImmediates");
}

pub fn emitBeforeExit() void {
    emitInstant("BeforeExit");
}

pub fn emitRunCleanup() void {
    emitInstant("RunCleanup");
}

pub fn emitAtExit() void {
    emitInstant("AtExit");
}
