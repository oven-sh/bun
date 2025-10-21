const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;
const CallFrame = jsc.CallFrame;

/// Categorizes operation types for routing telemetry data to appropriate handlers.
/// This enum maps 1:1 with the TypeScript InstrumentKind in packages/bun-otel/types.ts
pub const InstrumentKind = enum(u8) {
    custom = 0,
    http = 1,
    fetch = 2,
    sql = 3,
    redis = 4,
    s3 = 5,

    pub const COUNT = @typeInfo(InstrumentKind).@"enum".fields.len;
};

/// Stores registered instrumentation with cached function pointers for performance.
/// Lifecycle: Created during attach(), disposed during detach()
pub const InstrumentRecord = struct {
    /// Unique instrument ID (monotonic, never reused)
    id: u32,

    /// Operation category this instrument handles
    kind: InstrumentKind,

    /// Full JavaScript instrument object (protected from GC)
    native_instrument_object: JSValue,

    /// Cached function pointers (validated on attach, null if not provided)
    on_op_start_fn: JSValue,
    on_op_progress_fn: JSValue,
    on_op_end_fn: JSValue,
    on_op_error_fn: JSValue,
    on_op_inject_fn: JSValue,

    /// Initialize a new instrument record from a JavaScript instrument object
    pub fn init(
        id: u32,
        kind: InstrumentKind,
        instrument_obj: JSValue,
        global: *JSGlobalObject,
    ) !InstrumentRecord {
        // Validate that at least one hook function is provided
        const on_op_start = try instrument_obj.get(global, "onOperationStart") orelse .js_undefined;
        const on_op_progress = try instrument_obj.get(global, "onOperationProgress") orelse .js_undefined;
        const on_op_end = try instrument_obj.get(global, "onOperationEnd") orelse .js_undefined;
        const on_op_error = try instrument_obj.get(global, "onOperationError") orelse .js_undefined;
        const on_op_inject = try instrument_obj.get(global, "onOperationInject") orelse .js_undefined;

        // At least one hook must be callable
        const has_any_hook = on_op_start.isCallable() or
            on_op_progress.isCallable() or
            on_op_end.isCallable() or
            on_op_error.isCallable() or
            on_op_inject.isCallable();

        if (!has_any_hook) {
            return error.NoHooksProvided;
        }

        // Protect the instrument object from garbage collection
        instrument_obj.protect();

        return InstrumentRecord{
            .id = id,
            .kind = kind,
            .native_instrument_object = instrument_obj,
            .on_op_start_fn = on_op_start,
            .on_op_progress_fn = on_op_progress,
            .on_op_end_fn = on_op_end,
            .on_op_error_fn = on_op_error,
            .on_op_inject_fn = on_op_inject,
        };
    }

    /// Dispose of this instrument record and unprotect JSValues
    pub fn dispose(self: *InstrumentRecord) void {
        self.native_instrument_object.unprotect();
    }

    /// Invoke onOperationStart hook if present
    pub fn invokeStart(self: *InstrumentRecord, global: *JSGlobalObject, id: u64, info: JSValue) void {
        if (!self.on_op_start_fn.isCallable()) return;

        const args = [_]JSValue{
            JSValue.jsNumber(@as(f64, @floatFromInt(id))),
            info,
        };

        _ = self.on_op_start_fn.callWithGlobalThis(global, &args) catch |err| {
            // Defensive isolation: telemetry failures must not crash the application
            std.debug.print("Telemetry: onOperationStart failed: {}\n", .{err});
        };
    }

    /// Invoke onOperationEnd hook if present
    pub fn invokeEnd(self: *InstrumentRecord, global: *JSGlobalObject, id: u64, result: JSValue) void {
        if (!self.on_op_end_fn.isCallable()) return;

        const args = [_]JSValue{
            JSValue.jsNumber(@as(f64, @floatFromInt(id))),
            result,
        };

        _ = self.on_op_end_fn.callWithGlobalThis(global, &args) catch |err| {
            std.debug.print("Telemetry: onOperationEnd failed: {}\n", .{err});
        };
    }

    /// Invoke onOperationError hook if present
    pub fn invokeError(self: *InstrumentRecord, global: *JSGlobalObject, id: u64, error_info: JSValue) void {
        if (!self.on_op_error_fn.isCallable()) return;

        const args = [_]JSValue{
            JSValue.jsNumber(@as(f64, @floatFromInt(id))),
            error_info,
        };

        _ = self.on_op_error_fn.callWithGlobalThis(global, &args) catch |err| {
            std.debug.print("Telemetry: onOperationError failed: {}\n", .{err});
        };
    }

    /// Invoke onOperationInject hook if present, returns injected data or undefined
    pub fn invokeInject(self: *InstrumentRecord, global: *JSGlobalObject, id: u64, data: JSValue) JSValue {
        if (!self.on_op_inject_fn.isCallable()) return .js_undefined;

        const args = [_]JSValue{
            JSValue.jsNumber(@as(f64, @floatFromInt(id))),
            data,
        };

        return self.on_op_inject_fn.callWithGlobalThis(global, &args) catch |err| {
            std.debug.print("Telemetry: onOperationInject failed: {}\n", .{err});
            return .js_undefined;
        };
    }

    /// Invoke onOperationProgress hook if present
    pub fn invokeProgress(self: *InstrumentRecord, global: *JSGlobalObject, id: u64, attributes: JSValue) void {
        if (!self.on_op_progress_fn.isCallable()) return;

        const args = [_]JSValue{
            JSValue.jsNumber(@as(f64, @floatFromInt(id))),
            attributes,
        };

        _ = self.on_op_progress_fn.callWithGlobalThis(global, &args) catch |err| {
            std.debug.print("Telemetry: onOperationProgress failed: {}\n", .{err});
        };
    }
};

/// Global telemetry registry managing all registered instrumentations.
/// Singleton instance accessed via Bun.telemetry.* APIs.
pub const Telemetry = struct {
    /// Fixed-size array indexed by InstrumentKind, each containing a list of instruments
    instrument_table: [InstrumentKind.COUNT]std.ArrayList(InstrumentRecord),

    /// Monotonic instrument ID generator (thread-safe)
    next_instrument_id: std.atomic.Value(u32),

    /// Monotonic request ID generator (thread-safe)
    next_request_id: std.atomic.Value(u64),

    allocator: std.mem.Allocator,
    global: *JSGlobalObject,

    /// Initialize the global telemetry singleton
    pub fn init(allocator: std.mem.Allocator, global: *JSGlobalObject) !*Telemetry {
        const self = try allocator.create(Telemetry);

        // Initialize all instrument lists
        var instrument_table: [InstrumentKind.COUNT]std.ArrayList(InstrumentRecord) = undefined;
        for (&instrument_table) |*list| {
            list.* = std.ArrayList(InstrumentRecord).init(allocator);
        }

        self.* = Telemetry{
            .instrument_table = instrument_table,
            .next_instrument_id = std.atomic.Value(u32).init(1),
            .next_request_id = std.atomic.Value(u64).init(1),
            .allocator = allocator,
            .global = global,
        };

        return self;
    }

    /// Clean up telemetry singleton and all registered instruments
    pub fn deinit(self: *Telemetry) void {
        for (&self.instrument_table) |*list| {
            for (list.items) |*record| {
                record.dispose();
            }
            list.deinit();
        }
        self.allocator.destroy(self);
    }

    /// Generate a new unique instrument ID (thread-safe)
    fn generateInstrumentId(self: *Telemetry) u32 {
        return self.next_instrument_id.fetchAdd(1, .monotonic);
    }

    /// Generate a new unique request ID (thread-safe)
    pub fn generateRequestId(self: *Telemetry) u64 {
        return self.next_request_id.fetchAdd(1, .monotonic);
    }

    /// Attach a new instrumentation to the registry
    /// Returns the instrument ID on success, error on failure
    pub fn attach(self: *Telemetry, instrument_obj: JSValue, global: *JSGlobalObject) !u32 {
        // Validate instrument object
        if (!instrument_obj.isObject()) {
            return error.InvalidInstrument;
        }

        // Extract and validate 'type' field
        const type_value = try instrument_obj.get(global, "type") orelse return error.MissingType;
        if (!type_value.isNumber()) {
            return error.InvalidType;
        }

        const type_num = type_value.asInt32();
        if (type_num < 0 or type_num >= InstrumentKind.COUNT) {
            return error.InvalidType;
        }

        const kind: InstrumentKind = @enumFromInt(@as(u8, @intCast(type_num)));

        // Generate ID and create record
        const id = self.generateInstrumentId();
        const record = try InstrumentRecord.init(id, kind, instrument_obj, global);

        // Add to appropriate instrument list
        const kind_index = @intFromEnum(kind);
        try self.instrument_table[kind_index].append(record);

        return id;
    }

    /// Detach an instrumentation by ID
    /// Returns true if found and removed, false otherwise
    pub fn detach(self: *Telemetry, id: u32) bool {
        // Search all instrument lists for matching ID
        for (&self.instrument_table) |*list| {
            for (list.items, 0..) |*record, i| {
                if (record.id == id) {
                    record.dispose();
                    _ = list.swapRemove(i);
                    return true;
                }
            }
        }
        return false;
    }

    /// Check if telemetry is enabled for a given operation kind
    /// O(1) check - just checks if the instrument list for this kind is non-empty
    pub fn isEnabledFor(self: *Telemetry, kind: InstrumentKind) bool {
        const kind_index = @intFromEnum(kind);
        return self.instrument_table[kind_index].items.len > 0;
    }

    /// List all registered instruments, optionally filtered by kind
    pub fn listInstruments(self: *Telemetry, maybe_kind: ?InstrumentKind, global: *JSGlobalObject) !JSValue {
        const array = try JSValue.createEmptyArray(global, 0);
        var index: u32 = 0;

        if (maybe_kind) |kind| {
            // List only instruments of specified kind
            const kind_index = @intFromEnum(kind);
            for (self.instrument_table[kind_index].items) |*record| {
                const info = self.createInstrumentInfo(record, global);
                try array.putIndex(global, index, info);
                index += 1;
            }
        } else {
            // List all instruments
            for (&self.instrument_table) |*list| {
                for (list.items) |*record| {
                    const info = self.createInstrumentInfo(record, global);
                    try array.putIndex(global, index, info);
                    index += 1;
                }
            }
        }

        return array;
    }

    /// Create an InstrumentInfo object from an InstrumentRecord
    fn createInstrumentInfo(self: *Telemetry, record: *const InstrumentRecord, global: *JSGlobalObject) JSValue {
        _ = self;
        const info = JSValue.createEmptyObject(global, 4);

        info.put(global, "id", JSValue.jsNumber(@as(f64, @floatFromInt(record.id))));
        info.put(global, "kind", JSValue.jsNumber(@as(f64, @floatFromInt(@intFromEnum(record.kind)))));

        const name = (record.native_instrument_object.get(global, "name") catch null) orelse .js_undefined;
        info.put(global, "name", name);

        const version = (record.native_instrument_object.get(global, "version") catch null) orelse .js_undefined;
        info.put(global, "version", version);

        return info;
    }

    /// Invoke onOperationStart for all instruments registered for this kind
    pub fn notifyOperationStart(self: *Telemetry, kind: InstrumentKind, id: u64, info: JSValue) void {
        const kind_index = @intFromEnum(kind);
        for (self.instrument_table[kind_index].items) |*record| {
            record.invokeStart(self.global, id, info);
        }
    }

    /// Invoke onOperationEnd for all instruments registered for this kind
    pub fn notifyOperationEnd(self: *Telemetry, kind: InstrumentKind, id: u64, result: JSValue) void {
        const kind_index = @intFromEnum(kind);
        for (self.instrument_table[kind_index].items) |*record| {
            record.invokeEnd(self.global, id, result);
        }
    }

    /// Invoke onOperationError for all instruments registered for this kind
    pub fn notifyOperationError(self: *Telemetry, kind: InstrumentKind, id: u64, error_info: JSValue) void {
        const kind_index = @intFromEnum(kind);
        for (self.instrument_table[kind_index].items) |*record| {
            record.invokeError(self.global, id, error_info);
        }
    }

    /// Invoke onOperationInject for all instruments, merge returned headers
    pub fn notifyOperationInject(self: *Telemetry, kind: InstrumentKind, id: u64, data: JSValue) JSValue {
        const kind_index = @intFromEnum(kind);
        const merged = JSValue.createEmptyObject(self.global, 0);

        for (self.instrument_table[kind_index].items) |*record| {
            const injected = record.invokeInject(self.global, id, data);
            if (injected.isObject()) {
                // Merge injected headers into result
                const keys = injected.getOwnPropertyNames(self.global);
                const len = keys.getLength(self.global);

                var i: u32 = 0;
                while (i < len) : (i += 1) {
                    const key = keys.getIndex(self.global, i);
                    const value = injected.get(self.global, key.toString(self.global).toSlice(self.global).?);
                    if (value) |v| {
                        merged.put(self.global, key.toString(self.global).toSlice(self.global).?, v);
                    }
                }
            }
        }

        return merged;
    }
};

/// Semantic convention attribute keys for fast access.
/// Only includes attributes directly used by Bun core code.
pub const AttributeKey = enum(u8) {
    http_request_method,
    http_response_status_code,
    url_path,
    url_query,
    server_address,
    server_port,
    user_agent_original,
    http_request_body_size,
    http_response_body_size,
    error_type,
    error_message,
    network_peer_address,
    network_peer_port,

    pub fn toString(self: AttributeKey) []const u8 {
        return switch (self) {
            .http_request_method => "http.request.method",
            .http_response_status_code => "http.response.status_code",
            .url_path => "url.path",
            .url_query => "url.query",
            .server_address => "server.address",
            .server_port => "server.port",
            .user_agent_original => "user_agent.original",
            .http_request_body_size => "http.request.body.size",
            .http_response_body_size => "http.response.body.size",
            .error_type => "error.type",
            .error_message => "error.message",
            .network_peer_address => "network.peer.address",
            .network_peer_port => "network.peer.port",
        };
    }
};

/// AttributeMap wraps a JSValue object and provides fast attribute access.
/// MVP Implementation: Plain JSValue wrapper with enum-based accessor methods.
/// Future optimization: Native C++ class with perfect hash (see attributes-api-research.md)
pub const AttributeMap = struct {
    /// Internal storage: plain JavaScript object
    value: JSValue,
    global: *JSGlobalObject,

    /// Create a new empty attribute map
    pub fn init(global: *JSGlobalObject) AttributeMap {
        return AttributeMap{
            .value = JSValue.createEmptyObject(global, 16),
            .global = global,
        };
    }

    /// Fast set for known semantic convention attributes
    /// MVP: Internally uses string lookup (enum just for type safety)
    pub fn fastSet(self: *AttributeMap, key: AttributeKey, val: JSValue) void {
        const key_str = key.toString();
        self.value.put(self.global, key_str, val);
    }

    /// Fast get for known semantic convention attributes
    /// MVP: Internally uses string lookup
    pub fn fastGet(self: *AttributeMap, key: AttributeKey) JSValue {
        const key_str = key.toString();
        return self.value.get(self.global, key_str) orelse .js_undefined;
    }

    /// Set a custom attribute (string key)
    pub fn set(self: *AttributeMap, key: []const u8, val: JSValue) void {
        self.value.put(self.global, key, val);
    }

    /// Get a custom attribute (string key)
    pub fn get(self: *AttributeMap, key: []const u8) JSValue {
        return self.value.get(self.global, key) orelse .js_undefined;
    }

    /// Return the underlying JavaScript object (for passing to callbacks)
    pub fn toJS(self: *AttributeMap) JSValue {
        return self.value;
    }
};

// Global telemetry instance (initialized in JSGlobalObject)
var global_telemetry: ?*Telemetry = null;

/// Initialize the global telemetry instance
pub fn initGlobalTelemetry(allocator: std.mem.Allocator, global: *JSGlobalObject) !void {
    if (global_telemetry != null) return;
    global_telemetry = try Telemetry.init(allocator, global);
}

/// Get the global telemetry instance
pub fn getGlobalTelemetry() ?*Telemetry {
    return global_telemetry;
}

/// Shutdown the global telemetry instance
pub fn deinitGlobalTelemetry() void {
    if (global_telemetry) |t| {
        t.deinit();
        global_telemetry = null;
    }
}

/// C-compatible init function for use from C++ (returns 0 on success, 1 on error)
pub fn initGlobalTelemetryC(global: *JSGlobalObject) callconv(.C) c_int {
    // Use bun.default_allocator
    const allocator = bun.default_allocator;
    initGlobalTelemetry(allocator, global) catch {
        return 1; // Error
    };
    return 0; // Success
}

/// C-compatible deinit function
pub fn deinitGlobalTelemetryC() callconv(.C) void {
    deinitGlobalTelemetry();
}

// ====================
// JavaScript Bindings
// ====================

/// Bun.telemetry.attach(instrument: NativeInstrument): number
pub fn jsAttach(
    global: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        global.throw("telemetry.attach requires 1 argument (instrument object)", .{}) catch {};
        return .js_undefined;
    }

    const telemetry = getGlobalTelemetry() orelse {
        global.throw("Telemetry not initialized", .{}) catch {};
        return .js_undefined;
    };

    const instrument_obj = arguments.ptr[0];

    const id = telemetry.attach(instrument_obj, global) catch |err| {
        switch (err) {
            error.InvalidInstrument => global.throw("Instrument must be an object", .{}) catch {},
            error.MissingType => global.throw("Instrument must have a 'type' property", .{}) catch {},
            error.InvalidType => global.throw("Instrument 'type' must be a valid InstrumentKind", .{}) catch {},
            error.NoHooksProvided => global.throw("Instrument must provide at least one hook function", .{}) catch {},
            else => global.throw("Failed to attach instrument", .{}) catch {},
        }
        return .js_undefined;
    };

    return JSValue.jsNumber(@as(f64, @floatFromInt(id)));
}

/// Bun.telemetry.detach(id: number): boolean
pub fn jsDetach(
    _: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return JSValue.jsBoolean(false);
    }

    const telemetry = getGlobalTelemetry() orelse return JSValue.jsBoolean(false);

    const id_value = arguments.ptr[0];
    if (!id_value.isNumber()) {
        return JSValue.jsBoolean(false);
    }

    const num = id_value.asNumber();
    if (num < 0 or num > std.math.maxInt(u32)) {
        return JSValue.jsBoolean(false);
    }
    const id = @as(u32, @intFromFloat(num));
    const removed = telemetry.detach(id);

    return JSValue.jsBoolean(removed);
}

/// Bun.telemetry.isEnabledFor(kind: InstrumentKind): boolean
pub fn jsIsEnabledFor(
    _: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return JSValue.jsBoolean(false);
    }

    const telemetry = getGlobalTelemetry() orelse return JSValue.jsBoolean(false);

    const kind_value = arguments.ptr[0];
    if (!kind_value.isNumber()) {
        return JSValue.jsBoolean(false);
    }

    const kind_num = kind_value.asInt32();
    if (kind_num < 0 or kind_num >= InstrumentKind.COUNT) {
        return JSValue.jsBoolean(false);
    }

    const kind: InstrumentKind = @enumFromInt(@as(u8, @intCast(kind_num)));
    const enabled = telemetry.isEnabledFor(kind);

    return JSValue.jsBoolean(enabled);
}

/// Bun.telemetry.listInstruments(kind?: InstrumentKind): InstrumentInfo[]
pub fn jsListInstruments(
    global: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    const arguments = callframe.arguments_old(1);
    const telemetry = getGlobalTelemetry() orelse {
        return JSValue.createEmptyArray(global, 0) catch .js_undefined;
    };

    var maybe_kind: ?InstrumentKind = null;

    if (arguments.len >= 1 and arguments.ptr[0].isNumber()) {
        const kind_num = arguments.ptr[0].asInt32();
        if (kind_num >= 0 and kind_num < InstrumentKind.COUNT) {
            maybe_kind = @enumFromInt(@as(u8, @intCast(kind_num)));
        }
    }

    return telemetry.listInstruments(maybe_kind, global) catch .js_undefined;
}

/// Bun.telemetry.getActiveSpan(): { traceId: string, spanId: string } | null
/// TODO: Implement AsyncLocalStorage integration for trace context
pub fn jsGetActiveSpan(
    _: *JSGlobalObject,
    _: *CallFrame,
) callconv(.C) JSValue {
    // TODO: Implement AsyncLocalStorage lookup for active span context
    // For now, return null (will be implemented in Phase 5: Logging)
    return JSValue.jsNull();
}

// Export functions for C++ to call
comptime {
    if (!@import("builtin").is_test) {
        @export(&jsAttach, .{ .name = "Bun__Telemetry__attach" });
        @export(&jsDetach, .{ .name = "Bun__Telemetry__detach" });
        @export(&jsIsEnabledFor, .{ .name = "Bun__Telemetry__isEnabledFor" });
        @export(&jsListInstruments, .{ .name = "Bun__Telemetry__listInstruments" });
        @export(&jsGetActiveSpan, .{ .name = "Bun__Telemetry__getActiveSpan" });
        @export(&initGlobalTelemetryC, .{ .name = "Bun__Telemetry__init" });
        @export(&deinitGlobalTelemetryC, .{ .name = "Bun__Telemetry__deinit" });
    }
}
