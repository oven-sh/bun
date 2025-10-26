const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;
const CallFrame = jsc.CallFrame;
const ZigString = jsc.ZigString;

const telemetry_config = @import("config.zig");
pub const ConfigurationProperty = telemetry_config.ConfigurationProperty;
const TelemetryConfig = telemetry_config.TelemetryConfig;

const attributes_module = @import("attributes.zig");
pub const AttributeMap = attributes_module.AttributeMap;
pub const AttributeKey = attributes_module.AttributeKey;
pub const AttributeKeys = attributes_module.AttributeKeys;

/// Operation ID type - branded u64 for type safety
/// Prevents accidental mixing of operation IDs with other numeric values
pub const OpId = u64;

/// Operation timestamp type for telemetry timing
/// Uses i128 to store nanoseconds since epoch without overflow (until year 2262)
/// Can be changed to u64 if we switch to relative timing (bun.getRoughTickCountMs)
pub const OpTime = i128;

// ============================================================================
// Timing Utilities
// ============================================================================

/// Get high-precision timestamp for operation start
/// Returns nanoseconds since epoch as i128
///
/// PERFORMANCE NOTE: std.time.nanoTimestamp() requires a syscall on most platforms.
/// For rough timing (~1ms precision), consider using bun.getRoughTickCountMs() instead.
/// Current choice: High precision for OpenTelemetry compliance (nanosecond granularity).
/// Alternative: Return u64 from bun.getRoughTickCountMs() for faster but less accurate timing.
pub inline fn getOperationStartTime() OpTime {
    return std.time.nanoTimestamp();
}

/// Calculate operation duration in nanoseconds from start timestamp
/// Returns u64 (sufficient for any realistic operation duration - max ~584 years)
/// Handles negative durations (clock skew) by returning 0
pub inline fn calculateDuration(start_time: OpTime) u64 {
    const end_time = std.time.nanoTimestamp();
    const duration_signed = end_time - start_time;
    // Guard against clock skew or invalid timestamps
    return if (duration_signed < 0) 0 else @intCast(duration_signed);
}

/// HTTP server telemetry support
pub const http = @import("hooks-http.zig");

/// Fetch client telemetry support
pub const fetch = @import("hooks-fetch.zig");

/// SQL database telemetry support
pub const sql = @import("hooks-sql.zig");

/// Categorizes operation types for routing telemetry data to appropriate handlers.
/// This enum maps 1:1 with the TypeScript InstrumentKind in packages/bun-otel/types.ts
pub const InstrumentKind = enum(u8) {
    custom = 0,
    http = 1,
    fetch = 2,
    sql = 3,
    redis = 4,
    s3 = 5,
    node = 6,

    pub const COUNT = @typeInfo(InstrumentKind).@"enum".fields.len;
};

/// Operation lifecycle event types
/// Contract: specs/001-opentelemetry-support/contracts/telemetry-context.md lines 28-36
pub const OperationStep = enum(u8) {
    start = 0,
    progress = 1,
    end = 2,
    @"error" = 3,
    inject = 4,

    pub const COUNT = @typeInfo(OperationStep).@"enum".fields.len;
};

/// Parse an instrument kind from a string JSValue.
/// Accepts exact (case-sensitive) enum names: "custom", "http", "fetch", "sql", "redis", "s3", "node".
/// Returns .custom (0) if the value is not a string or does not match a known kind.
pub fn parseStringInstrumentType(globalObject: *JSGlobalObject, val: JSValue) InstrumentKind {
    if (!val.isString()) return .custom;
    const zstr = val.getZigString(globalObject) catch return .custom;
    const slice = zstr.slice();
    return std.meta.stringToEnum(InstrumentKind, slice) orelse .custom;
}

/// Stores registered instrumentation with cached function pointers for performance.
/// Lifecycle: Created during attach(), disposed during detach()
pub const InstrumentRecord = struct {
    /// Unique instrument ID (monotonic, never reused)
    id: u32,

    /// Operation category this instrument handles
    kind: InstrumentKind,

    /// Full JavaScript instrument object (protected from GC)
    native_instrument_object: JSValue,

    /// Cached function pointers for operation steps
    on_op_fns: [OperationStep.COUNT]JSValue,

    /// Per-instrument configuration (null if instrument has no injectHeaders config)
    /// Contains parsed header injection configuration from instrument.injectHeaders
    instrument_config: ?TelemetryConfig,

    telemetry_context: *TelemetryContext,

    /// Initialize a new instrument record from a JavaScript instrument object
    pub fn init(
        id: u32,
        kind: InstrumentKind,
        instrument_obj: JSValue,
        globalObject: *JSGlobalObject,
        allocator: std.mem.Allocator,
        telemetry_context: *TelemetryContext,
    ) !InstrumentRecord {
        // Validate that at least one hook function is provided
        const on_op_start = try instrument_obj.get(globalObject, "onOperationStart") orelse .js_undefined;
        const on_op_progress = try instrument_obj.get(globalObject, "onOperationProgress") orelse .js_undefined;
        const on_op_end = try instrument_obj.get(globalObject, "onOperationEnd") orelse .js_undefined;
        const on_op_error = try instrument_obj.get(globalObject, "onOperationError") orelse .js_undefined;
        const on_op_inject = try instrument_obj.get(globalObject, "onOperationInject") orelse .js_undefined;

        // At least one hook must be callable
        const has_any_hook = on_op_start.isCallable() or
            on_op_progress.isCallable() or
            on_op_end.isCallable() or
            on_op_error.isCallable() or
            on_op_inject.isCallable();

        if (!has_any_hook) {
            return error.NoHooksProvided;
        }

        // Parse injectHeaders and captureAttributes configuration if present
        var instrument_config: ?TelemetryConfig = null;

        const inject_headers = try instrument_obj.get(globalObject, "injectHeaders") orelse .js_undefined;
        const capture_attrs = try instrument_obj.get(globalObject, "captureAttributes") orelse .js_undefined;

        if (inject_headers.isObject() or capture_attrs.isObject()) {
            // Create a minimal TelemetryConfig for this instrument's configuration
            var config = try TelemetryConfig.init(allocator, globalObject, telemetry_context.semconv);
            errdefer config.deinit();

            // Parse injectHeaders if present
            if (inject_headers.isObject()) {
                // Parse request headers (for fetch client)
                const request_headers = try inject_headers.get(globalObject, "request") orelse .js_undefined;
                if (request_headers.isArray()) {
                    try config.set(@intFromEnum(ConfigurationProperty.http_propagate_headers_fetch_request), request_headers);
                }

                // Parse response headers (for HTTP server)
                const response_headers = try inject_headers.get(globalObject, "response") orelse .js_undefined;
                if (response_headers.isArray()) {
                    try config.set(@intFromEnum(ConfigurationProperty.http_propagate_headers_server_response), response_headers);
                }
            }

            // Parse captureAttributes if present
            if (capture_attrs.isObject()) {
                // Determine capture configuration properties based on instrument kind
                const req_capture_prop: ?ConfigurationProperty = switch (kind) {
                    .http => .http_capture_headers_server_request,
                    .fetch => .http_capture_headers_fetch_request,
                    else => null,
                };

                const res_capture_prop: ?ConfigurationProperty = switch (kind) {
                    .http => .http_capture_headers_server_response,
                    .fetch => .http_capture_headers_fetch_response,
                    else => null,
                };

                // Parse request headers
                if (req_capture_prop) |prop| {
                    const request_headers = try capture_attrs.get(globalObject, "requestHeaders") orelse .js_undefined;
                    if (request_headers.isArray()) {
                        try config.set(@intFromEnum(prop), request_headers);
                    }
                }

                // Parse response headers
                if (res_capture_prop) |prop| {
                    const response_headers = try capture_attrs.get(globalObject, "responseHeaders") orelse .js_undefined;
                    if (response_headers.isArray()) {
                        try config.set(@intFromEnum(prop), response_headers);
                    }
                }
            }

            instrument_config = config;
        }

        // Protect the instrument object from garbage collection
        instrument_obj.protect();

        // Create array of hook functions
        const op_fns = [_]JSValue{
            on_op_start,
            on_op_progress,
            on_op_end,
            on_op_error,
            on_op_inject,
        };

        // Protect all hook functions
        for (op_fns) |hook_fn| {
            hook_fn.protect();
        }

        return InstrumentRecord{
            .id = id,
            .kind = kind,
            .native_instrument_object = instrument_obj,
            .on_op_fns = op_fns,
            .instrument_config = instrument_config,
            .telemetry_context = telemetry_context,
        };
    }

    /// Dispose of this instrument record and unprotect JSValues
    pub fn dispose(self: *InstrumentRecord) void {
        self.native_instrument_object.unprotect();

        // Clean up instrument config if present
        if (self.instrument_config) |*config| {
            config.deinit();
        }
        for (self.on_op_fns) |maybe_fn| {
            if (maybe_fn.isCallable()) {
                maybe_fn.unprotect();
            }
        }
    }

    pub inline fn invokeOn(self: *InstrumentRecord, globalObject: *JSGlobalObject, step: OperationStep, id: OpId, info: JSValue) JSValue {
        const op_fn = self.on_op_fns[@intFromEnum(step)];
        if (!op_fn.isCallable()) return .js_undefined;

        const args = [_]JSValue{
            jsRequestId(id),
            info,
        };

        // Call with the instrument object as 'this' instead of globalThis
        // This allows callbacks to access instance properties via 'this'
        return op_fn.call(globalObject, self.native_instrument_object, &args) catch |err| {
            // Defensive isolation: telemetry failures must not crash the application
            std.debug.print("Telemetry: operation hook failed: {}\n", .{err});
            // Clear the pending JavaScript exception to avoid assertion failures
            _ = globalObject.takeException(err);
            return .js_undefined;
        };
    }
};

/// Global telemetry registry managing all registered instrumentations.
/// Singleton instance accessed via Bun.telemetry.* APIs.
pub const TelemetryContext = struct {
    /// Fixed-size array indexed by InstrumentKind, each containing a list of instruments
    instrument_table: [InstrumentKind.COUNT]std.ArrayList(InstrumentRecord),

    /// Fixed-size array of instruments with the corresponding callback registered (minimizes nullchecks)
    operations_table: [InstrumentKind.COUNT][OperationStep.COUNT]std.ArrayList(*InstrumentRecord),

    /// Semantic conventions attribute keys (shared singleton)
    semconv: *AttributeKeys,

    /// Monotonic instrument ID generator (thread-safe)
    next_instrument_id: std.atomic.Value(u32),

    /// Monotonic request ID generator (thread-safe)
    next_request_id: std.atomic.Value(u64),

    /// Configuration manager (handles both JS and native property storage)
    config: TelemetryConfig,

    allocator: std.mem.Allocator,
    globalObject: *JSGlobalObject,

    /// Initialize the global telemetry singleton
    pub fn init(allocator: std.mem.Allocator, globalObject: *JSGlobalObject) !*TelemetryContext {
        const self = try allocator.create(TelemetryContext);

        // Initialize all instrument lists
        var instrument_table: [InstrumentKind.COUNT]std.ArrayList(InstrumentRecord) = undefined;
        for (&instrument_table) |*list| {
            list.* = std.ArrayList(InstrumentRecord).init(allocator);
        }

        // Initialize all operation lists (2D: [kind][step])
        var operations_table: [InstrumentKind.COUNT][OperationStep.COUNT]std.ArrayList(*InstrumentRecord) = undefined;
        for (&operations_table) |*kind_table| {
            for (kind_table) |*step_list| {
                step_list.* = std.ArrayList(*InstrumentRecord).init(allocator);
            }
        }

        // Initialize semantic conventions attribute keys (needed by config)
        const semconv_keys = try allocator.create(AttributeKeys);
        semconv_keys.* = try AttributeKeys.init(allocator);

        // Initialize configuration manager (requires attribute_keys for HeaderNameList)
        const config = try TelemetryConfig.init(allocator, globalObject, semconv_keys);

        self.* = TelemetryContext{
            .instrument_table = instrument_table,
            .operations_table = operations_table,
            .semconv = semconv_keys,
            .next_instrument_id = std.atomic.Value(u32).init(1),
            .next_request_id = std.atomic.Value(u64).init(1),
            .config = config,
            .allocator = allocator,
            .globalObject = globalObject,
        };

        return self;
    }

    /// Clean up telemetry singleton and all registered instruments
    pub fn deinit(self: *TelemetryContext) void {
        // Clean up semantic conventions before instrument table
        self.semconv.deinit();
        self.allocator.destroy(self.semconv);

        for (&self.instrument_table) |*list| {
            for (list.items) |*record| {
                record.dispose();
            }
            list.deinit();
        }
        // [kind][step] -> ArrayList(*InstrumentRecord)
        for (&self.operations_table) |*kind_table| {
            for (kind_table) |*step_list| {
                step_list.deinit();
            }
        }

        // Clean up configuration manager
        self.config.deinit();

        self.allocator.destroy(self);
    }

    /// Enter async context by calling AsyncLocalStorage.enterWith(context)
    /// Called from Zig hooks after creating span to propagate context across async boundaries
    ///
    /// @param globalObject The JavaScript global object
    /// @param spanContext The OTel span context object to enter (has { requestId, traceId, spanId })
    pub fn enterContext(self: *TelemetryContext, globalObject: *JSGlobalObject, spanContext: JSValue) void {
        // Get context storage from configuration property
        const storage = self.getConfigurationProperty(@intFromEnum(ConfigurationProperty._context_storage));
        if (storage.isEmptyOrUndefinedOrNull()) return;

        // Get enterWith method from AsyncLocalStorage instance
        const enter_with = storage.get(globalObject, "enterWith") catch return;
        if (enter_with) |ew| {
            if (!ew.isCallable()) return;
            // Call storage.enterWith(spanContext)
            _ = ew.call(globalObject, storage, &.{spanContext}) catch {};
        }
    }

    /// Generate a new unique instrument ID (thread-safe)
    fn generateInstrumentId(self: *TelemetryContext) u32 {
        return self.next_instrument_id.fetchAdd(1, .monotonic);
    }

    /// Generate a new unique operation ID (thread-safe)
    pub inline fn generateId(self: *TelemetryContext) OpId {
        return self.next_request_id.fetchAdd(1, .monotonic);
    }

    /// Create a new AttributeMap for operation attributes
    pub inline fn createAttributeMap(self: *TelemetryContext) AttributeMap {
        return AttributeMap.init(self.globalObject);
    }

    /// Get a configuration property value by its enum ID
    /// Returns the JSValue for the property, or .js_undefined if invalid
    pub fn getConfigurationProperty(self: *TelemetryContext, property_id: u8) JSValue {
        return self.config.get(property_id);
    }

    /// Set a configuration property, keeping both JS and native arrays in sync
    /// Unprotects old JSValue if present, validates after setting
    pub fn setConfigurationProperty(self: *TelemetryContext, property_id: u8, js_value: JSValue) !void {
        try self.config.set(property_id, js_value);
    }

    /// Get the list of instruments registered for a given operation step and kind
    pub inline fn getOnOperations(self: *TelemetryContext, op: OperationStep, kind: InstrumentKind) *std.ArrayList(*InstrumentRecord) {
        return &self.operations_table[@intFromEnum(kind)][@intFromEnum(op)];
    }

    /// Attach a new instrumentation to the registry
    /// Returns the instrument ID on success, error on failure
    ///
    /// SECURITY: This native function does NOT validate header names for security.
    /// It is the caller's responsibility (packages/bun-otel SDK) to validate that:
    /// - injectHeaders do not include sensitive headers (authorization, cookie, set-cookie, etc.)
    /// - captureAttributes do not include sensitive headers
    /// - Header names follow RFC 9110 specifications
    /// See: specs/001-opentelemetry-support/contracts/header-injection.md for blocked header list
    pub fn attach(self: *TelemetryContext, instrument_obj: JSValue, globalObject: *JSGlobalObject) !u32 {
        // Validate instrument object
        if (!instrument_obj.isObject()) {
            return error.InvalidInstrument;
        }

        // Extract and validate 'type' field
        const type_value = try instrument_obj.get(globalObject, "type") orelse return error.MissingType;
        var kind: InstrumentKind = .custom;
        if (type_value.isNumber()) {
            const type_num = type_value.asInt32();
            if (type_num < 0 or type_num >= InstrumentKind.COUNT) {
                return error.InvalidType;
            }
            kind = @enumFromInt(@as(u8, @intCast(type_num)));
        } else if (type_value.isString()) {
            kind = parseStringInstrumentType(globalObject, type_value);
            // parseStringInstrumentType always returns a valid InstrumentKind (defaults to .custom)
        } else {
            return error.InvalidType;
        }

        // Generate ID and create record
        const id = self.generateInstrumentId();
        const record = try InstrumentRecord.init(id, kind, instrument_obj, globalObject, self.allocator, self);

        // Add to appropriate instrument list
        const kind_index = @intFromEnum(kind);
        try self.instrument_table[kind_index].append(record);

        // Rebuild inject and capture config for this kind if it's HTTP or Fetch
        if (kind == .http or kind == .fetch) {
            try self.config.rebuildInjectConfig(kind, self.instrument_table[kind_index].items);
            try self.config.rebuildCaptureConfig(kind, self.instrument_table[kind_index].items);
        }
        // Rebuild operations table
        self.rebuildOperationTable();

        return id;
    }

    /// Rebuild the operations table based on current registered instruments
    /// [
    ///   start -> [inst1, inst2, inst3]
    ///   progress -> [inst1]
    ///   end -> [inst2, inst3]
    ///   error -> []
    ///   ...
    /// ]
    fn rebuildOperationTable(self: *TelemetryContext) void {
        // Clear all operation lists
        for (&self.operations_table) |*kind_table| {
            for (kind_table) |*step_list| {
                step_list.clearRetainingCapacity();
            }
        }
        // Populate operation lists based on registered instruments
        for (&self.instrument_table) |*list| {
            for (list.items) |*record| {
                // Iterate through all operation steps
                inline for (0..OperationStep.COUNT) |step_idx| {
                    const step: OperationStep = @enumFromInt(step_idx);
                    const op_fn = record.on_op_fns[step_idx];
                    if (op_fn.isCallable()) {
                        self.getOnOperations(step, record.kind).append(record) catch {
                            // This should never fail in practice since we pre-allocate
                            std.debug.print("Telemetry: Failed to append to operations table\n", .{});
                        };
                    }
                }
            }
        }
    }

    /// Detach an instrumentation by ID
    /// Returns true if found and removed, false otherwise
    pub fn detach(self: *TelemetryContext, id: u32) bool {
        // Search all instrument lists for matching ID
        for (&self.instrument_table, 0..) |*list, kind_idx| {
            for (list.items, 0..) |*record, i| {
                if (record.id == id) {
                    const kind: InstrumentKind = @enumFromInt(@as(u8, @intCast(kind_idx)));
                    record.dispose();
                    _ = list.swapRemove(i);

                    // Rebuild inject and capture config for this kind if it's HTTP or Fetch
                    if (kind == .http or kind == .fetch) {
                        self.config.rebuildInjectConfig(kind, list.items) catch |err| {
                            std.debug.print("Telemetry: Failed to rebuild inject config on detach: {}\n", .{err});
                        };
                        self.config.rebuildCaptureConfig(kind, list.items) catch |err| {
                            std.debug.print("Telemetry: Failed to rebuild capture config on detach: {}\n", .{err});
                        };
                    }
                    // Rebuild operations table
                    self.rebuildOperationTable();
                    return true;
                }
            }
        }
        return false;
    }

    /// Check if telemetry is enabled for a given operation kind
    /// O(1) check - just checks if the instrument list for this kind is non-empty
    pub fn isEnabledFor(self: *TelemetryContext, kind: InstrumentKind) bool {
        const kind_index = @intFromEnum(kind);
        return self.instrument_table[kind_index].items.len > 0;
    }

    /// List all registered instruments, optionally filtered by kind
    pub fn listInstruments(self: *TelemetryContext, maybe_kind: ?InstrumentKind, globalObject: *JSGlobalObject) !JSValue {
        const array = try JSValue.createEmptyArray(globalObject, 0);
        var index: u32 = 0;

        if (maybe_kind) |kind| {
            // List only instruments of specified kind
            const kind_index = @intFromEnum(kind);
            for (self.instrument_table[kind_index].items) |*record| {
                const info = self.createInstrumentInfo(record, globalObject);
                try array.putIndex(globalObject, index, info);
                index += 1;
            }
        } else {
            // List all instruments
            for (&self.instrument_table) |*list| {
                for (list.items) |*record| {
                    const info = self.createInstrumentInfo(record, globalObject);
                    try array.putIndex(globalObject, index, info);
                    index += 1;
                }
            }
        }

        return array;
    }

    /// Create an InstrumentInfo object from an InstrumentRecord
    fn createInstrumentInfo(self: *TelemetryContext, record: *const InstrumentRecord, globalObject: *JSGlobalObject) JSValue {
        _ = self;
        const info = JSValue.createEmptyObject(globalObject, 4);

        info.put(globalObject, "id", JSValue.jsNumber(@as(f64, @floatFromInt(record.id))));
        info.put(globalObject, "kind", JSValue.jsNumber(@as(f64, @floatFromInt(@intFromEnum(record.kind)))));

        const name = (record.native_instrument_object.get(globalObject, "name") catch null) orelse .js_undefined;
        info.put(globalObject, "name", name);

        const version = (record.native_instrument_object.get(globalObject, "version") catch null) orelse .js_undefined;
        info.put(globalObject, "version", version);

        return info;
    }

    /// Notify TypeScript layer of an operation event (base dispatch method)
    /// This is the low-level API that all helper methods (notifyOperationStart, etc.) use internally
    /// Contract: specs/001-opentelemetry-support/contracts/telemetry-context.md lines 75-81
    ///
    /// @param op: Operation type (start, progress, end, error, inject)
    /// @param kind: Instrumentation Target (comptime for O(1) dispatch)
    /// @param id: OpId from generateId()
    /// @param attrs: *AttributeMap with operation attributes
    /// @return JSValue (.js_undefined except for inject which returns injection data)
    /// Invoke operation hooks serially, passing attributes through each hook.
    /// Each hook receives current attributes and can return modified attributes.
    /// Returns final attributes (call-sites ignore return value if not needed).
    pub inline fn notifyOperation(
        self: *TelemetryContext,
        comptime op: OperationStep,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap,
    ) JSValue {
        const hooks = self.getOnOperations(op, kind).items;
        if (hooks.len == 0) return .js_undefined;

        // Start with attributes, let each hook modify them serially
        var current_attrs = attrs.toJS();

        for (hooks) |record| {
            const result = record.invokeOn(self.globalObject, op, id, current_attrs);
            // Hook can return modified attributes or undefined to keep current. Allow empty to clear.
            if (!result.isUndefinedOrNull()) {
                current_attrs = result;
            }
        }

        return current_attrs;
    }

    /// Invoke onOperationStart for all instruments registered for this kind
    pub inline fn notifyOperationStart(
        self: *TelemetryContext,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap,
    ) void {
        _ = self.notifyOperation(.start, kind, id, attrs);
    }

    /// Invoke onOperationProgress for all instruments registered for this kind
    pub inline fn notifyOperationProgress(
        self: *TelemetryContext,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap,
    ) void {
        _ = self.notifyOperation(.progress, kind, id, attrs);
    }

    /// Invoke onOperationEnd for all instruments registered for this kind
    pub inline fn notifyOperationEnd(
        self: *TelemetryContext,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap,
    ) void {
        _ = self.notifyOperation(.end, kind, id, attrs);
    }

    /// Invoke onOperationError for all instruments registered for this kind
    pub inline fn notifyOperationError(
        self: *TelemetryContext,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap,
    ) void {
        _ = self.notifyOperation(.@"error", kind, id, attrs);
    }

    /// Invoke onOperationInject for all instruments, collect results into array
    /// Returns a flat array of property values from all instruments
    pub inline fn notifyOperationInject(
        self: *TelemetryContext,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap,
    ) JSValue {
        return self.notifyOperation(.inject, kind, id, attrs);
    }
};

// ============================================================================
// Request ID Utilities
// ============================================================================

/// Convert a request ID (u64) to a JavaScript number value.
/// Note: JavaScript numbers are IEEE 754 double precision (53-bit integer precision).
/// Request IDs up to 2^53-1 (9007199254740991) are safe, beyond will wrap.
/// This is like 1 million requests per second for 285 years.
pub inline fn jsRequestId(id: u64) JSValue {
    return JSValue.jsNumber(@as(f64, @floatFromInt(id)));
}

/// Parse a request ID from a JavaScript value with validation.
/// Ensures the value is a finite, positive, safe integer (1 to 2^53-1).
/// Returns an error if the value is invalid.
pub fn requestIdFromJS(globalObject: *JSGlobalObject, value: JSValue) bun.JSError!u64 {
    const id_num = try value.toNumber(globalObject);
    if (!std.math.isFinite(id_num)) {
        return globalObject.throwTypeError("Request ID must be a finite number", .{});
    }
    const id_u64: u64 = @intFromFloat(@floor(id_num));
    if (@as(f64, @floatFromInt(id_u64)) != id_num or id_u64 == 0 or id_u64 > 9007199254740991) {
        return globalObject.throwTypeError("Request ID must be a positive safe integer", .{});
    }
    return @intCast(id_u64);
}

// ============================================================================
// Global Telemetry Instance
// ============================================================================

// Global telemetry instance (initialized in JSGlobalObject)
var global_telemetry: ?*TelemetryContext = null;
/// Exposed pointer to semantic convention attribute keys for use by configuration code
/// This mirrors bun.telemetry.semconv expected by config.zig when creating HeaderNameList
/// It is assigned during initGlobalTelemetry after the TelemetryContext is created.
pub var semconv: *AttributeKeys = undefined;

/// Initialize the global telemetry instance
pub fn initGlobalTelemetry(allocator: std.mem.Allocator, globalObject: *JSGlobalObject) !void {
    if (global_telemetry != null) return;
    global_telemetry = try TelemetryContext.init(allocator, globalObject);
    // Publish semantic convention keys for config.zig (bun.telemetry.semconv)
    semconv = global_telemetry.?.semconv;
}

/// Get the current telemetry context, or null if disabled
pub fn enabled() ?*TelemetryContext {
    return global_telemetry;
}

/// Get the global telemetry instance (backward compatibility)
pub fn getGlobalTelemetry() ?*TelemetryContext {
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
pub fn initGlobalTelemetryC(globalObject: *JSGlobalObject) callconv(.C) c_int {
    // Use bun.default_allocator
    const allocator = bun.default_allocator;
    initGlobalTelemetry(allocator, globalObject) catch {
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

/// Symbol.dispose callback for InstrumentRef
/// Reads this.id and calls telemetry.detach(id)
pub fn jsInstrumentRefDispose(
    globalObject: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    const this = callframe.this();

    const telemetry = getGlobalTelemetry() orelse return .js_undefined;

    // Read this.id
    const maybe_id_value = this.get(globalObject, "id") catch return .js_undefined;
    const id_value = maybe_id_value orelse return .js_undefined;
    if (!id_value.isNumber()) {
        return .js_undefined;
    }

    const num = id_value.asNumber();
    if (num < 0 or num > std.math.maxInt(u32)) {
        return .js_undefined;
    }

    const id = @as(u32, @intFromFloat(num));
    _ = telemetry.detach(id);

    return .js_undefined;
}

/// Bun.telemetry.attach(instrument: NativeInstrument): InstrumentRef
pub fn jsAttach(
    globalObject: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        globalObject.throw("telemetry.attach requires 1 argument (instrument object)", .{}) catch {};
        return .js_undefined;
    }

    // Initialize global telemetry on first attach (zero-cost until used)
    if (getGlobalTelemetry() == null) {
        initGlobalTelemetry(bun.default_allocator, globalObject) catch {
            globalObject.throw("Failed to initialize telemetry", .{}) catch {};
            return .js_undefined;
        };
    }

    const telemetry = getGlobalTelemetry() orelse {
        globalObject.throw("Telemetry initialization failed", .{}) catch {};
        return .js_undefined;
    };

    const instrument_obj = arguments.ptr[0];

    const id = telemetry.attach(instrument_obj, globalObject) catch |err| {
        switch (err) {
            error.InvalidInstrument => globalObject.throw("Instrument must be an object", .{}) catch {},
            error.MissingType => globalObject.throw("Instrument must have a 'type' property", .{}) catch {},
            error.InvalidType => globalObject.throw("Instrument 'type' must be a valid InstrumentKind", .{}) catch {},
            error.NoHooksProvided => globalObject.throw("Instrument must provide at least one hook function", .{}) catch {},
            else => globalObject.throw("Failed to attach instrument", .{}) catch {},
        }
        return .js_undefined;
    };

    // Create InstrumentRef object with { id, [Symbol.dispose] }
    const ref_obj = JSValue.createEmptyObject(globalObject, 2);

    // Set the id property
    ref_obj.put(globalObject, "id", JSValue.jsNumber(@as(f64, @floatFromInt(id))));

    // Create the dispose function and bind it to ref_obj
    const dispose_fn = jsc.host_fn.NewFunction(globalObject, ZigString.static("dispose"), 0, jsInstrumentRefDispose, false);
    const bound_dispose = dispose_fn.bind(globalObject, ref_obj, &bun.String.static("dispose"), 0, &.{}) catch return .js_undefined;

    // Get Symbol.dispose from VM
    const dispose_symbol = JSC__JSGlobalObject__getDisposeSymbol(globalObject);

    // Set Symbol.dispose (required for `using` statement)
    ref_obj.putToPropertyKey(globalObject, dispose_symbol, bound_dispose) catch {};

    // Also set .dispose() for manual cleanup compatibility
    ref_obj.put(globalObject, "dispose", bound_dispose);

    return ref_obj;
}

// Forward declaration of C++ function to get Symbol.dispose
extern fn JSC__JSGlobalObject__getDisposeSymbol(globalObject: *jsc.JSGlobalObject) JSValue;

/// Bun.telemetry.detach(idOrRef: number | InstrumentRef): boolean
/// Accepts either a raw number (backward compatibility) or an InstrumentRef object
pub fn jsDetach(
    globalObject: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return JSValue.jsBoolean(false);
    }

    const telemetry = getGlobalTelemetry() orelse return JSValue.jsBoolean(false);

    const arg = arguments.ptr[0];

    // Extract ID from either InstrumentRef object or raw number
    var id: u32 = 0;

    if (arg.isNumber()) {
        // Backward compatibility: accept raw number
        const num = arg.asNumber();
        if (num < 0 or num > std.math.maxInt(u32)) {
            return JSValue.jsBoolean(false);
        }
        id = @as(u32, @intFromFloat(num));
    } else if (arg.isObject()) {
        // Accept InstrumentRef object with id property
        const maybe_id_value = arg.get(globalObject, "id") catch return JSValue.jsBoolean(false);
        const id_value = maybe_id_value orelse return JSValue.jsBoolean(false);
        if (!id_value.isNumber()) {
            return JSValue.jsBoolean(false);
        }

        const num = id_value.asNumber();
        if (num < 0 or num > std.math.maxInt(u32)) {
            return JSValue.jsBoolean(false);
        }
        id = @as(u32, @intFromFloat(num));
    } else {
        // Invalid argument type
        return JSValue.jsBoolean(false);
    }

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
    const is_enabled = telemetry.isEnabledFor(kind);

    return JSValue.jsBoolean(is_enabled);
}

/// Bun.telemetry.listInstruments(kind?: InstrumentKind): InstrumentInfo[]
pub fn jsListInstruments(
    globalObject: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    const arguments = callframe.arguments_old(1);
    const telemetry = getGlobalTelemetry() orelse {
        return JSValue.createEmptyArray(globalObject, 0) catch .js_undefined;
    };

    var maybe_kind: ?InstrumentKind = null;

    if (arguments.len >= 1 and arguments.ptr[0].isNumber()) {
        const kind_num = arguments.ptr[0].asInt32();
        if (kind_num >= 0 and kind_num < InstrumentKind.COUNT) {
            maybe_kind = @enumFromInt(@as(u8, @intCast(kind_num)));
        }
    }

    return telemetry.listInstruments(maybe_kind, globalObject) catch .js_undefined;
}

// ============================================================================
// JS Bridge Helpers
// ============================================================================

/// Generic JS handler for operation notifications
/// Handles argument parsing, validation, and dispatching to all registered instruments
/// Returns .js_undefined for most operations, or a result array for inject
inline fn jsNotifyOperationGeneric(
    callframe: *CallFrame,
    comptime step: OperationStep,
) JSValue {
    const arguments = callframe.arguments_old(3);
    if (arguments.len < 3) return .js_undefined;

    const telemetry = getGlobalTelemetry() orelse return .js_undefined;

    const kind_value = arguments.ptr[0];
    const id_value = arguments.ptr[1];
    const data = arguments.ptr[2];

    if (!kind_value.isNumber() or !id_value.isNumber()) return .js_undefined;

    const kind_num = kind_value.asInt32();
    if (kind_num < 0 or kind_num >= InstrumentKind.COUNT) return .js_undefined;

    const kind: InstrumentKind = @enumFromInt(@as(u8, @intCast(kind_num)));
    var id = @as(u64, @intFromFloat(id_value.asNumber()));

    // Auto-generate OpId if 0 is provided (starts at 1)
    if (id == 0) {
        id = telemetry.generateId();
    }

    // Get instruments for this kind
    const kind_index = @intFromEnum(kind);
    const instruments = telemetry.instrument_table[kind_index].items;
    if (instruments.len == 0) return .js_undefined;

    // For inject operation, collect results into array
    if (step == .inject) {
        const result_array = JSValue.createEmptyArray(telemetry.globalObject, @intCast(instruments.len)) catch return .js_undefined;
        for (instruments, 0..) |*record, i| {
            const result = record.invokeOn(telemetry.globalObject, step, id, data);
            if (!result.isUndefined()) {
                result_array.putIndex(telemetry.globalObject, @intCast(i), result) catch {};
            }
        }
        return result_array;
    }

    // For other operations, just invoke without collecting results
    for (instruments) |*record| {
        _ = record.invokeOn(telemetry.globalObject, step, id, data);
    }
    return .js_undefined;
}

// ============================================================================
// JS Bridge API Functions
// ============================================================================

/// Bun.telemetry.nativeHooks.notifyStart(kind: number, id: number, attributes: object): void
/// Internal API for TypeScript telemetry bridges (e.g., internal/telemetry_http.ts)
pub fn jsNotifyOperationStart(
    _: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    return jsNotifyOperationGeneric(callframe, .start);
}

/// Bun.telemetry.nativeHooks.notifyEnd(kind: number, id: number, attributes: object): void
/// Internal API for TypeScript telemetry bridges
pub fn jsNotifyOperationEnd(
    _: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    return jsNotifyOperationGeneric(callframe, .end);
}

/// Bun.telemetry.nativeHooks.notifyError(kind: number, id: number, attributes: object): void
/// Internal API for TypeScript telemetry bridges
pub fn jsNotifyOperationError(
    _: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    return jsNotifyOperationGeneric(callframe, .@"error");
}

/// Bun.telemetry.nativeHooks.notifyProgress(kind: number, id: number, attributes: object): void
/// Internal API for TypeScript telemetry bridges
pub fn jsNotifyOperationProgress(
    _: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    return jsNotifyOperationGeneric(callframe, .progress);
}

/// Bun.telemetry.nativeHooks.notifyInject(kind: number, id: number, data: object): object
/// Internal API for TypeScript telemetry bridges
/// Returns merged injected data from all registered instruments
pub fn jsNotifyOperationInject(
    _: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    return jsNotifyOperationGeneric(callframe, .inject);
}

/// Bun.telemetry.nativeHooks.getConfigurationProperty(propertyId: number): any
/// Returns the configuration property value for the given ID
/// Internal API for TypeScript telemetry bridges
pub fn jsGetConfigurationProperty(
    _: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return .js_undefined;
    }

    const telemetry = getGlobalTelemetry() orelse return .js_undefined;

    const property_id_value = arguments.ptr[0];
    if (!property_id_value.isNumber()) {
        return .js_undefined;
    }

    const property_id = property_id_value.asInt32();
    if (property_id < 0 or property_id >= ConfigurationProperty.COUNT) {
        return .js_undefined;
    }

    return telemetry.getConfigurationProperty(@as(u8, @intCast(property_id)));
}

/// Bun.telemetry.nativeHooks.setConfigurationProperty(propertyId: number, value: any): void
/// Sets a configuration property value, keeping JS and native arrays in sync
/// Internal API for TypeScript telemetry configuration
pub fn jsSetConfigurationProperty(
    globalObject: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    const arguments = callframe.arguments_old(2);
    if (arguments.len < 2) {
        globalObject.throw("setConfigurationProperty requires 2 arguments (propertyId, value)", .{}) catch {};
        return .js_undefined;
    }

    const telemetry = getGlobalTelemetry() orelse {
        globalObject.throw("Telemetry not initialized", .{}) catch {};
        return .js_undefined;
    };

    const property_id_value = arguments.ptr[0];
    if (!property_id_value.isNumber()) {
        globalObject.throw("Property ID must be a number", .{}) catch {};
        return .js_undefined;
    }

    const property_id = property_id_value.asInt32();
    if (property_id < 0 or property_id >= ConfigurationProperty.COUNT) {
        globalObject.throw("Invalid property ID", .{}) catch {};
        return .js_undefined;
    }

    const value = arguments.ptr[1];
    telemetry.setConfigurationProperty(@as(u8, @intCast(property_id)), value) catch |err| {
        switch (err) {
            error.InvalidProperty => globalObject.throw("Cannot set RESERVED property", .{}) catch {},
            else => globalObject.throw("Failed to set configuration property", .{}) catch {},
        }
        return .js_undefined;
    };

    return .js_undefined;
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

/// Bun.telemetry.nativeHooks(): object | undefined
/// Returns the nativeHooks object if telemetry is enabled, undefined otherwise.
/// This provides zero-cost abstraction - when telemetry is disabled, the optional
/// chain short-circuits immediately without allocating parameters.
///
/// Usage: Bun.telemetry.nativeHooks()?.notifyStart(kind, id, attributes)
///
/// This mirrors the Zig pattern: if (telemetry.enabled()) |otel| { ... }
pub fn jsNativeHooks(
    globalObject: *JSGlobalObject,
    callframe: *CallFrame,
) callconv(.C) JSValue {
    // Return undefined if telemetry is not initialized or disabled
    _ = getGlobalTelemetry() orelse return .js_undefined;

    // Telemetry is enabled, return the cached nativeHooks object
    // The object is stored on the telemetry namespace as _nativeHooksObject
    const this = callframe.this();
    const native_hooks_obj = this.get(globalObject, "_nativeHooksObject") catch return .js_undefined;
    return native_hooks_obj orelse .js_undefined;
}

// Export functions for C++ to call
comptime {
    if (!@import("builtin").is_test) {
        @export(&jsAttach, .{ .name = "Bun__Telemetry__attach" });
        @export(&jsDetach, .{ .name = "Bun__Telemetry__detach" });
        @export(&jsIsEnabledFor, .{ .name = "Bun__Telemetry__isEnabledFor" });
        @export(&jsListInstruments, .{ .name = "Bun__Telemetry__listInstruments" });
        @export(&jsGetActiveSpan, .{ .name = "Bun__Telemetry__getActiveSpan" });
        @export(&jsNativeHooks, .{ .name = "Bun__Telemetry__nativeHooks" });
        @export(&jsNotifyOperationStart, .{ .name = "Bun__Telemetry__nativeHooks__notifyStart" });
        @export(&jsNotifyOperationEnd, .{ .name = "Bun__Telemetry__nativeHooks__notifyEnd" });
        @export(&jsNotifyOperationError, .{ .name = "Bun__Telemetry__nativeHooks__notifyError" });
        @export(&jsNotifyOperationProgress, .{ .name = "Bun__Telemetry__nativeHooks__notifyProgress" });
        @export(&jsNotifyOperationInject, .{ .name = "Bun__Telemetry__nativeHooks__notifyInject" });
        @export(&jsGetConfigurationProperty, .{ .name = "Bun__Telemetry__nativeHooks__getConfigurationProperty" });
        @export(&jsSetConfigurationProperty, .{ .name = "Bun__Telemetry__nativeHooks__setConfigurationProperty" });
        @export(&initGlobalTelemetryC, .{ .name = "Bun__Telemetry__init" });
        @export(&deinitGlobalTelemetryC, .{ .name = "Bun__Telemetry__deinit" });

        // SQL telemetry export (defined in hooks-sql.zig)
        @export(&sql.Bun__telemetry__sql__register_trace, .{ .name = "Bun__telemetry__sql__register_trace" });
    }
}
