const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const os = std.os;
const Output = bun.Output;
const strings = bun.strings;
const JSGlobalObject = JSC.JSGlobalObject;
const JSString = JSC.JSString;
const JSValue = JSC.JSValue;

extern fn uv_os_getpid() c_int;

/// Node.js trace events implementation
/// This is used when --trace-event-categories is passed
pub const TraceEvents = struct {
    const Self = @This();

    /// Singleton instance
    pub var instance: ?*Self = null;

    file: ?std.fs.File = null,
    categories: []const u8 = "",
    first_event: bool = true,
    enabled: bool = false,
    recursion_guard: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    pid: u32,
    start_time: u64,
    events: std.ArrayList(Event) = undefined,
    allocator: std.mem.Allocator,
    is_writing: bool = false, // Guard against recursion

    const Event = struct {
        name: []const u8,
        cat: []const u8,
        ph: u8, // phase - B (begin), E (end), X (complete), I (instant)
        ts: u64, // timestamp in microseconds
        pid: u32,
        tid: u32,
        dur: ?u64 = null, // duration in microseconds (for X events)
        args: ?JSC.JSValue = null,
    };

    pub fn init(allocator: std.mem.Allocator, categories: []const u8, cwd: []const u8) !void {
        if (instance != null) return;

        const self = try allocator.create(TraceEvents);
        self.* = .{
            .categories = categories,
            .pid = @intCast(uv_os_getpid()),
            .start_time = bun.getRoughTickCountMs(),
            .events = std.ArrayList(Event).init(allocator),
            .allocator = allocator,
            .enabled = true, // Enable trace events
        };

        // Create trace file path
        var buf: bun.PathBuffer = undefined;
        const path = try std.fmt.bufPrint(&buf, "{s}/node_trace.1.log", .{cwd});
        self.file = try std.fs.cwd().createFile(path, .{ .truncate = true });

        // Write opening bracket
        _ = try self.file.?.write("{\"traceEvents\":[\n");

        instance = self;

        // Emit the required metadata
        const header =
            \\{"name":"__metadata","ph":"M","pid":
        ;

        var meta_buf: [1024]u8 = undefined;
        const metadata = try std.fmt.bufPrint(&meta_buf, "{s}{d},\"tid\":0,\"ts\":0,\"args\":{{\"name\":\"bun\"}}}},\n", .{ header, self.pid });

        _ = try self.file.?.write(metadata);
    }

    pub fn deinit() void {
        if (instance) |self| {
            self.finalize() catch {};
            self.allocator.destroy(self);
            instance = null;
        }
    }

    fn writeMetadataEvent(self: *TraceEvents) !void {
        // Write the initial JSON structure
        const header =
            \\{"traceEvents":[
            \\{"name":"process_name","ph":"M","pid":
        ;

        var buf: [1024]u8 = undefined;
        const metadata = try std.fmt.bufPrint(&buf, "{s}{d},\"tid\":0,\"ts\":0,\"args\":{{\"name\":\"bun\"}}}},\n", .{ header, self.pid });

        self.file.?.writeAll(metadata) catch {};
    }

    /// Emit a trace event (thread-safe)
    pub fn emit(name: []const u8, phase: u8) void {
        const self = instance orelse return;

        // Prevent recursion using atomic compare-and-swap
        if (self.recursion_guard.swap(true, .seq_cst)) {
            // Already emitting, skip this event
            return;
        }
        defer _ = self.recursion_guard.swap(false, .seq_cst);

        const now = bun.getRoughTickCountMs();
        const ts = (now - self.start_time) * 1000; // Convert to microseconds

        // Buffer the event in memory instead of writing immediately
        const event = Event{
            .name = name,
            .cat = "node.environment",
            .ph = phase,
            .ts = ts,
            .pid = self.pid,
            .tid = 0, // Main thread
        };

        // Append to events array (we'll write them all during finalization)
        self.events.append(event) catch {
            // If we can't allocate, just skip this event
            return;
        };
    }

    /// Helper to emit instant events (most common case)
    pub fn emitInstant(name: []const u8) void {
        emit(name, 'I');
    }

    pub fn emitBegin(name: []const u8) void {
        emit(name, 'B');
    }

    pub fn emitEnd(name: []const u8) void {
        emit(name, 'E');
    }

    fn writeEvent(self: *TraceEvents, event: *const Event) !void {
        if (self.file == null) return;

        var buf: [1024]u8 = undefined;
        const json = try std.fmt.bufPrint(&buf,
            \\{{"name":"{s}","cat":"{s}","ph":"{c}","ts":{d},"pid":{d},"tid":{d}}},
            \\
        , .{ event.name, event.cat, event.ph, event.ts, event.pid, event.tid });

        _ = try self.file.?.write(json);
    }

    pub fn finalize(self: *TraceEvents) !void {
        if (self.file) |file| {
            // Write all buffered events
            for (self.events.items) |*event| {
                try self.writeEvent(event);
            }

            // Write the closing bracket
            _ = try file.write("{\"name\":\"__metadata\",\"ph\":\"M\",\"pid\":0,\"tid\":0,\"ts\":0,\"args\":{\"thread_name\":\"__metadata\"}}]}\n");
            file.close();
            self.file = null;
        }
    }

    pub fn shouldEmit(category: []const u8) bool {
        const self = instance orelse return false;
        if (!self.enabled) return false;

        // Check if the category matches the enabled categories
        // For now, we'll emit all "node.environment" events when enabled
        return strings.eqlComptime(category, "node.environment");
    }
};
