const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const Output = bun.Output;
const telemetry = @import("telemetry.zig");
const attributes = @import("attributes.zig");
const AttributeMap = attributes.AttributeMap;
const AttributeKey = attributes.AttributeKey;
const semconv = @import("semconv.zig");

// SQLite trace event codes (from sqlite3.h)
pub const SQLITE_TRACE_STMT: u32 = 0x01;
pub const SQLITE_TRACE_PROFILE: u32 = 0x02;
pub const SQLITE_TRACE_ROW: u32 = 0x04;
pub const SQLITE_TRACE_CLOSE: u32 = 0x08;

/// Opaque sqlite3 type (defined in C)
const sqlite3 = opaque {};
const sqlite3_stmt = opaque {};

/// Trace callback context - stores database operation info
const TraceContext = struct {
    globalObject: *JSGlobalObject,
    db_path: []const u8,
    operation_id: u64,
    allocator: std.mem.Allocator,

    pub fn init(
        globalObject: *JSGlobalObject,
        db_path: []const u8,
        operation_id: u64,
        allocator: std.mem.Allocator,
    ) !*TraceContext {
        const ctx = try allocator.create(TraceContext);
        ctx.* = .{
            .globalObject = globalObject,
            .db_path = try allocator.dupe(u8, db_path),
            .operation_id = operation_id,
            .allocator = allocator,
        };
        return ctx;
    }

    pub fn deinit(self: *TraceContext) void {
        self.allocator.free(self.db_path);
        self.allocator.destroy(self);
    }
};

/// SQLite trace callback - called by sqlite3_trace_v2()
///
/// Arguments:
/// - event_type: SQLITE_TRACE_* constant
/// - ctx: void pointer to TraceContext
/// - p_arg: varies by event type
/// - x_arg: varies by event type
///
/// Event types:
/// - STMT: p_arg = sqlite3_stmt*, x_arg = unexpanded SQL string
/// - PROFILE: p_arg = sqlite3_stmt*, x_arg = duration in nanoseconds (uint64_t*)
/// - CLOSE: p_arg = sqlite3*, x_arg = unused
export fn sqliteTraceCallback(
    event_type: c_uint,
    ctx_ptr: ?*anyopaque,
    p_arg: ?*anyopaque,
    x_arg: ?*anyopaque,
) callconv(.C) c_int {
    const ctx = @as(*TraceContext, @ptrCast(@alignCast(ctx_ptr orelse return 0)));

    switch (event_type) {
        SQLITE_TRACE_PROFILE => {
            // Query completed - p_arg is sqlite3_stmt*, x_arg is duration (nanoseconds)
            const stmt = @as(*sqlite3_stmt, @ptrCast(@alignCast(p_arg orelse return 0)));
            const duration_ptr = @as(*i64, @ptrCast(@alignCast(x_arg orelse return 0)));
            const duration_ns = duration_ptr.*;

            handleQueryComplete(ctx, stmt, duration_ns) catch |err| {
                Output.prettyErrorln("SQL telemetry PROFILE error: {}", .{err});
            };
        },
        SQLITE_TRACE_CLOSE => {
            // Database closing
            handleDatabaseClose(ctx) catch |err| {
                Output.prettyErrorln("SQL telemetry CLOSE error: {}", .{err});
            };
        },
        else => {
            // Ignore STMT and ROW events
        },
    }

    return 0; // Return value currently ignored by SQLite
}

/// C wrappers for lazy-loaded SQLite functions
extern fn Bun__sqlite3_sql_wrapper(stmt: *sqlite3_stmt) [*:0]const u8;
extern fn Bun__sqlite3_trace_v2_wrapper(
    db: *sqlite3,
    mask: c_uint,
    callback: *const fn (c_uint, ?*anyopaque, ?*anyopaque, ?*anyopaque) callconv(.C) c_int,
    ctx: ?*anyopaque,
) c_int;

/// Handle SQLITE_TRACE_PROFILE event - query has completed
fn handleQueryComplete(
    ctx: *TraceContext,
    stmt: *sqlite3_stmt,
    duration_ns: i64,
) !void {
    const otel = telemetry.enabled() orelse return;
    if (!otel.isEnabledFor(.sql)) return;

    // Get SQL text from statement
    const sql_text = std.mem.span(Bun__sqlite3_sql_wrapper(stmt));

    // Build query attributes
    var attrs = buildQueryAttributes(
        ctx.globalObject,
        ctx.db_path,
        sql_text,
        duration_ns,
    );

    // Report as operation progress (one progress event per query)
    otel.notifyOperationProgress(.sql, ctx.operation_id, &attrs);
}

/// Handle SQLITE_TRACE_CLOSE event - database is closing
fn handleDatabaseClose(ctx: *TraceContext) !void {
    const otel = telemetry.enabled() orelse return;
    if (!otel.isEnabledFor(.sql)) return;

    // Empty attributes for close event
    var attrs = AttributeMap.init(ctx.globalObject);

    // Report database close
    otel.notifyOperationEnd(.sql, ctx.operation_id, &attrs);

    // Clean up context - this callback is called during sqlite3_close() and the
    // context is no longer needed after notifyOperationEnd returns
    ctx.deinit();
}

/// Build query attributes for progress event
fn buildQueryAttributes(
    globalObject: *JSGlobalObject,
    db_path: []const u8,
    query_text: []const u8,
    duration_ns: i64,
) AttributeMap {
    const otel = telemetry.getGlobalTelemetry() orelse {
        return AttributeMap.init(globalObject);
    };

    var attrs = AttributeMap.init(globalObject);

    // Timestamp
    const timestamp_ns = std.time.nanoTimestamp();
    attrs.set(otel.semconv.operation_timestamp, timestamp_ns);

    // Duration (from SQLite PROFILE event)
    attrs.set(otel.semconv.operation_duration, duration_ns);

    // Database system
    attrs.set(otel.semconv.db_system_name, "sqlite");

    // Database namespace (file path)
    if (db_path.len > 0) {
        attrs.set(otel.semconv.db_namespace, db_path);
    }

    // Query text
    if (query_text.len > 0) {
        attrs.set(otel.semconv.db_query_text, query_text);
    }

    // Extract operation name and table name
    if (extractQueryOperation(query_text)) |operation| {
        attrs.set(otel.semconv.db_operation_name, operation);
    }

    if (extractTableName(query_text)) |table_name| {
        attrs.set(otel.semconv.db_collection_name, table_name);
    }

    // Generate query summary
    if (generateQuerySummary(query_text)) |summary_result| {
        defer if (summary_result.owned) std.heap.c_allocator.free(summary_result.text);
        attrs.set(otel.semconv.db_query_summary, summary_result.text);
    }

    return attrs;
}

/// Extract SQL operation from query text (SELECT, INSERT, UPDATE, DELETE, etc.)
fn extractQueryOperation(query: []const u8) ?[]const u8 {
    var i: usize = 0;
    while (i < query.len and std.ascii.isWhitespace(query[i])) : (i += 1) {}
    if (i >= query.len) return null;

    const start = i;
    while (i < query.len and !std.ascii.isWhitespace(query[i])) : (i += 1) {}

    const operation = query[start..i];

    const operations = [_][]const u8{
        "SELECT", "INSERT", "UPDATE",   "DELETE",
        "CREATE", "DROP",   "ALTER",    "PRAGMA",
        "BEGIN",  "COMMIT", "ROLLBACK",
    };

    for (operations) |op| {
        if (std.ascii.eqlIgnoreCase(operation, op)) {
            return op;
        }
    }

    return null;
}

/// Extract table name from SQL query
fn extractTableName(query: []const u8) ?[]const u8 {
    const query_upper = std.ascii.allocUpperString(
        std.heap.c_allocator,
        query,
    ) catch return null;
    defer std.heap.c_allocator.free(query_upper);

    // Look for "FROM tablename"
    if (std.mem.indexOf(u8, query_upper, " FROM ")) |from_idx| {
        const after_from = from_idx + 6;
        if (after_from >= query.len) return null;

        var i = after_from;
        while (i < query.len and std.ascii.isWhitespace(query[i])) : (i += 1) {}

        const table_start = i;
        while (i < query.len) : (i += 1) {
            const c = query[i];
            if (std.ascii.isWhitespace(c) or c == ',' or c == ';' or c == ')') {
                if (i > table_start) return query[table_start..i];
                return null;
            }
        }
        if (i > table_start) return query[table_start..i];
    }

    // Look for "INTO tablename"
    if (std.mem.indexOf(u8, query_upper, " INTO ")) |into_idx| {
        const after_into = into_idx + 6;
        if (after_into >= query.len) return null;

        var i = after_into;
        while (i < query.len and std.ascii.isWhitespace(query[i])) : (i += 1) {}

        const table_start = i;
        while (i < query.len) : (i += 1) {
            const c = query[i];
            if (std.ascii.isWhitespace(c) or c == '(' or c == ';') {
                if (i > table_start) return query[table_start..i];
                return null;
            }
        }
        if (i > table_start) return query[table_start..i];
    }

    // Look for "UPDATE tablename"
    if (std.mem.indexOf(u8, query_upper, "UPDATE ")) |update_idx| {
        const after_update = update_idx + 7;
        if (after_update >= query.len) return null;

        var i = after_update;
        while (i < query.len and std.ascii.isWhitespace(query[i])) : (i += 1) {}

        const table_start = i;
        while (i < query.len) : (i += 1) {
            const c = query[i];
            if (std.ascii.isWhitespace(c) or c == ';') {
                if (i > table_start) return query[table_start..i];
                return null;
            }
        }
        if (i > table_start) return query[table_start..i];
    }

    return null;
}

/// Result from generateQuerySummary indicating ownership
const QuerySummary = struct {
    text: []const u8,
    owned: bool, // true if text was allocated and must be freed
};

/// Generate low-cardinality query summary
fn generateQuerySummary(query: []const u8) ?QuerySummary {
    const operation = extractQueryOperation(query) orelse return null;
    const table = extractTableName(query);

    if (table) |t| {
        const summary = std.fmt.allocPrint(
            std.heap.c_allocator,
            "{s} {s}",
            .{ operation, t },
        ) catch return .{ .text = operation, .owned = false };
        return .{ .text = summary, .owned = true };
    }

    return .{ .text = operation, .owned = false };
}

// ============================================================================
// C++ Export Function
// ============================================================================

/// C++ bridge: Register SQLite trace callback for a database connection
/// Should be called immediately after sqlite3_open_v2() succeeds
///
/// Returns operation ID (>0) on success, 0 on failure
pub fn Bun__telemetry__sql__register_trace(
    globalObject: *JSGlobalObject,
    db: *sqlite3,
    db_path_ptr: [*]const u8,
    db_path_len: usize,
) callconv(.C) u64 {
    const otel = telemetry.enabled() orelse return 0;
    if (!otel.isEnabledFor(.sql)) return 0;

    const db_path = db_path_ptr[0..db_path_len];

    // Generate operation ID for this database (monotonic, clean ID)
    const operation_id = otel.generateId();

    // Create trace context
    const ctx = TraceContext.init(
        globalObject,
        db_path,
        operation_id,
        std.heap.c_allocator,
    ) catch {
        Output.prettyErrorln("SQL telemetry: failed to create trace context", .{});
        return 0;
    };

    // Build start attributes
    var start_attrs = AttributeMap.init(globalObject);
    start_attrs.set(otel.semconv.operation_id, telemetry.jsRequestId(operation_id));
    start_attrs.set(otel.semconv.operation_timestamp, std.time.nanoTimestamp());
    start_attrs.set(otel.semconv.db_system_name, "sqlite");
    if (db_path.len > 0) {
        start_attrs.set(otel.semconv.db_namespace, db_path);
    }

    // Notify database opened
    otel.notifyOperationStart(.sql, operation_id, &start_attrs);

    // Register trace callback with SQLite
    const mask = SQLITE_TRACE_PROFILE | SQLITE_TRACE_CLOSE;
    const result = Bun__sqlite3_trace_v2_wrapper(db, mask, sqliteTraceCallback, ctx);

    if (result != 0) {
        Output.prettyErrorln("SQL telemetry: sqlite3_trace_v2 failed with code {}", .{result});
        ctx.deinit();
        return 0;
    }

    return operation_id;
}

// Function is exported from telemetry.zig
