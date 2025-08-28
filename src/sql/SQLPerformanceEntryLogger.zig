const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;

extern "C" fn JSC__addSQLQueryPerformanceEntry(globalObject: *jsc.JSGlobalObject, name: [*:0]const u8, description: [*:0]const u8, startTime: f64, endTime: f64) void;

/// Shared SQL performance entry logger for tracking query performance across different SQL adapters
pub const SQLPerformanceEntryLogger = struct {
    /// Start time for performance tracking (in nanoseconds)
    start_time_ns: u64 = 0,

    const Self = @This();

    /// Extract the SQL command from the query string (e.g., "SELECT", "INSERT", etc.)
    fn extractSQLCommand(query: []const u8) []const u8 {
        if (query.len == 0) return "UNKNOWN";
        
        var i: usize = 0;
        // Skip leading whitespace
        while (i < query.len and std.ascii.isWhitespace(query[i])) {
            i += 1;
        }
        
        const start_pos = i;
        // Find the end of the first word
        while (i < query.len and !std.ascii.isWhitespace(query[i])) {
            i += 1;
        }
        
        if (i <= start_pos) return "UNKNOWN";
        
        const command = query[start_pos..i];
        
        // Convert common commands to uppercase
        if (std.ascii.eqlIgnoreCase(command, "select")) return "SELECT";
        if (std.ascii.eqlIgnoreCase(command, "insert")) return "INSERT";
        if (std.ascii.eqlIgnoreCase(command, "update")) return "UPDATE";
        if (std.ascii.eqlIgnoreCase(command, "delete")) return "DELETE";
        if (std.ascii.eqlIgnoreCase(command, "create")) return "CREATE";
        if (std.ascii.eqlIgnoreCase(command, "drop")) return "DROP";
        if (std.ascii.eqlIgnoreCase(command, "alter")) return "ALTER";
        if (std.ascii.eqlIgnoreCase(command, "show")) return "SHOW";
        if (std.ascii.eqlIgnoreCase(command, "describe") or std.ascii.eqlIgnoreCase(command, "desc")) return "DESCRIBE";
        if (std.ascii.eqlIgnoreCase(command, "explain")) return "EXPLAIN";
        if (std.ascii.eqlIgnoreCase(command, "truncate")) return "TRUNCATE";
        if (std.ascii.eqlIgnoreCase(command, "grant")) return "GRANT";
        if (std.ascii.eqlIgnoreCase(command, "revoke")) return "REVOKE";
        
        return "UNKNOWN";
    }

    /// Start performance tracking for a query
    pub fn start(self: *Self) void {
        self.start_time_ns = @as(u64, @intCast(@max(0, std.time.nanoTimestamp())));
    }

    /// End performance tracking and report to the performance API
    pub fn end(self: *Self, performance_entries_enabled: bool, query: bun.String, globalObject: *jsc.JSGlobalObject) void {
        if (!performance_entries_enabled or self.start_time_ns == 0) return;
        
        const end_time_ns = @as(u64, @intCast(@max(0, std.time.nanoTimestamp())));
        const start_time_ms = @as(f64, @floatFromInt(self.start_time_ns)) / 1_000_000.0;
        const end_time_ms = @as(f64, @floatFromInt(end_time_ns)) / 1_000_000.0;
        
        // Get the SQL command and query string
        var query_utf8 = query.toUTF8(bun.default_allocator);
        defer query_utf8.deinit();
        
        const command = extractSQLCommand(query_utf8.slice());
        
        // Create null-terminated strings for the C function
        const command_cstr = bun.default_allocator.dupeZ(u8, command) catch return;
        defer bun.default_allocator.free(command_cstr);
        
        const query_cstr = bun.default_allocator.dupeZ(u8, query_utf8.slice()) catch return;
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