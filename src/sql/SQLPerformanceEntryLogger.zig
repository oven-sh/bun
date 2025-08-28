extern "C" fn JSC__addSQLQueryPerformanceEntry(globalObject: *jsc.JSGlobalObject, name: [*:0]const u8, description: [*:0]const u8, startTime: f64, endTime: f64) void;

/// Shared SQL performance entry logger for tracking query performance across different SQL adapters
pub const SQLPerformanceEntryLogger = struct {
    /// Start time for performance tracking (in nanoseconds)
    start_time_ns: u64 = 0,

    const Self = @This();

    /// Start performance tracking for a query
    pub fn start(self: *Self) void {
        self.start_time_ns = @as(u64, @intCast(@max(0, std.time.nanoTimestamp())));
    }

    /// End performance tracking and report to the performance API
    /// command_tag_str: The command tag string from server or parsed query (e.g., "SELECT 1", "INSERT 0 1")
    /// query_description: A description or sanitized version of the query for performance tracking
    pub fn end(self: *Self, performance_entries_enabled: bool, command_tag_str: ?[]const u8, query_description: []const u8, globalObject: *jsc.JSGlobalObject) void {
        if (!performance_entries_enabled or self.start_time_ns == 0) return;

        // Extract command name from command tag (uses same logic as existing CommandTag parsing)
        const command_name = if (command_tag_str) |tag_str| blk: {
            const first_space_index = bun.strings.indexOfChar(tag_str, ' ') orelse tag_str.len;
            break :blk tag_str[0..first_space_index];
        } else "UNKNOWN";

        const end_time_ns = @as(u64, @intCast(@max(0, std.time.nanoTimestamp())));
        const start_time_ms = @as(f64, @floatFromInt(self.start_time_ns)) / 1_000_000.0;
        const end_time_ms = @as(f64, @floatFromInt(end_time_ns)) / 1_000_000.0;

        // Create null-terminated strings for the C function
        const command_cstr = bun.default_allocator.dupeZ(u8, command_name) catch return;
        defer bun.default_allocator.free(command_cstr);

        const query_cstr = bun.default_allocator.dupeZ(u8, query_description) catch return;
        defer bun.default_allocator.free(query_cstr);

        // Call the C++ binding to add the performance entry
        JSC__addSQLQueryPerformanceEntry(globalObject, command_cstr.ptr, query_cstr.ptr, start_time_ms, end_time_ms);
    }

    /// Initialize a new logger instance
    pub fn init() Self {
        return Self{};
    }

    /// Reset the logger (clear start time)
    pub fn reset(self: *Self) void {
        self.start_time_ns = 0;
    }
};

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
