const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const WebCore = bun.jsc.WebCore;

const logger = bun.Output.scoped(.telemetry, .hidden);

/// Request ID type - using u64 for simplicity and performance
/// This is similar to how Node.js handles timer IDs
pub const RequestId = u64;

/// Global telemetry instance
var instance: ?*Telemetry = null;

/// Response builder for collecting telemetry data
/// This struct collects response metadata and fires telemetry once
/// It's designed to be a zero-cost abstraction when telemetry is disabled
pub const ResponseBuilder = struct {
    request_id: RequestId,
    status_code: u16 = 0,
    content_length: u64 = 0,
    headers_js: JSValue = .zero,
    global: *JSGlobalObject,
    telemetry: *Telemetry,

    const Self = @This();

    /// Set the HTTP status code
    pub fn setStatus(self: *Self, status: u16) void {
        self.status_code = status;
    }

    /// Set the content length
    pub fn setContentLength(self: *Self, length: u64) void {
        self.content_length = length;
    }

    /// Capture whitelisted headers from FetchHeaders
    /// For now, we'll pass all headers to JS and let it filter
    /// Future optimization: filter in native code based on config
    pub fn setHeaders(self: *Self, headers: *WebCore.FetchHeaders) void {
        // Convert headers to JS and store
        // We protect the headers so they don't get GC'd before we fire
        const headers_js = headers.toJS(self.global);
        if (!headers_js.isUndefinedOrNull()) {
            headers_js.protect();
            // Unprotect old headers if we had any
            if (self.headers_js != .zero) {
                self.headers_js.unprotect();
            }
            self.headers_js = headers_js;
        }
    }

    /// Inject correlation headers into FetchHeaders before they are written
    /// This calls onResponseStart callback and injects the returned headers using pre-parsed header names
    pub fn injectHeaders(self: *Self, headers: *WebCore.FetchHeaders) void {
        // Fast path: no callback or no headers configured
        if (self.telemetry.on_response_start == .zero or self.telemetry.copy2response_headers.len == 0) {
            return;
        }

        const id_js = jsRequestId(self.request_id);
        Telemetry.callAndInjectHeaders(
            self.telemetry.on_response_start,
            self.telemetry.copy2response_headers,
            headers,
            self.global,
            &.{id_js},
            "onResponseStart",
        );
    }

    /// Fire the telemetry callback and clean up
    pub fn fireAndForget(self: *Self) void {
        defer self.deinit();

        // Only fire if we have the callback
        if (!self.telemetry.enabled or self.telemetry.on_response_headers == .zero) {
            return;
        }

        const id_js = jsRequestId(self.request_id);
        const status_js = JSValue.jsNumber(@as(f64, @floatFromInt(self.status_code)));
        const content_length_js = JSValue.jsNumber(@as(f64, @floatFromInt(self.content_length)));

        // Call with headers if we have them, otherwise call with just status and length
        if (self.headers_js != .zero) {
            _ = self.telemetry.on_response_headers.call(
                self.global,
                .js_undefined,
                &.{ id_js, status_js, content_length_js, self.headers_js },
            ) catch |err|
                self.global.takeException(err);
        } else {
            _ = self.telemetry.on_response_headers.call(
                self.global,
                .js_undefined,
                &.{ id_js, status_js, content_length_js },
            ) catch |err|
                self.global.takeException(err);
        }
    }

    fn deinit(self: *Self) void {
        // Unprotect headers if we have them
        if (self.headers_js != .zero) {
            self.headers_js.unprotect();
        }
        // Free the builder
        bun.default_allocator.destroy(self);
    }
};

pub const Telemetry = struct {
    /// Atomic counter for generating request IDs
    next_request_id: std.atomic.Value(RequestId),

    /// Callbacks for request lifecycle events
    on_request_start: JSValue = .zero,
    on_request_end: JSValue = .zero,
    on_request_error: JSValue = .zero,
    on_response_start: JSValue = .zero,
    on_response_headers: JSValue = .zero,

    /// Node.js compatibility binding object (set via configure)
    _node_binding: JSValue = .zero,

    /// AsyncLocalStorage instance for context propagation (provided by user)
    _context_storage: JSValue = .zero,

    /// Headers to copy to response (stored as bun.String for uncommon headers like x-trace-id)
    copy2response_headers: []const bun.String = &.{},

    /// Whether telemetry is enabled
    enabled: bool = false,

    /// Whether telemetry has been configured
    configured: bool = false,

    /// Reference to the global object
    global: *JSGlobalObject,

    const Self = @This();

    pub fn init(global: *JSGlobalObject) !*Self {
        if (instance) |existing| {
            return existing;
        }

        const self = try bun.default_allocator.create(Self);
        self.* = .{
            .next_request_id = std.atomic.Value(RequestId).init(1),
            .global = global,
        };

        instance = self;
        return self;
    }

    pub fn deinit(self: *Self) void {
        if (self.on_request_start != .zero) {
            self.on_request_start.unprotect();
        }
        if (self.on_request_end != .zero) {
            self.on_request_end.unprotect();
        }
        if (self.on_request_error != .zero) {
            self.on_request_error.unprotect();
        }
        if (self.on_response_start != .zero) {
            self.on_response_start.unprotect();
        }
        if (self.on_response_headers != .zero) {
            self.on_response_headers.unprotect();
        }
        if (self._node_binding != .zero) {
            self._node_binding.unprotect();
        }
        if (self._context_storage != .zero) {
            self._context_storage.unprotect();
        }

        for (self.copy2response_headers) |header| {
            header.deref();
        }
        if (self.copy2response_headers.len > 0) {
            bun.default_allocator.free(self.copy2response_headers);
        }

        if (instance == self) {
            instance = null;
        }

        bun.default_allocator.destroy(self);
    }

    /// Get the singleton instance, or null if not initialized
    pub fn getInstance() ?*Self {
        return instance;
    }

    /// Generate a new unique request ID
    pub fn generateRequestId(self: *Self) RequestId {
        return self.next_request_id.fetchAdd(1, .monotonic);
    }

    /// Clear all telemetry callbacks and reset state
    /// This is a private helper used by both configure(null) and disable()
    fn reset(self: *Self) void {
        // Unprotect all callbacks
        if (self.on_request_start != .zero) {
            self.on_request_start.unprotect();
            self.on_request_start = .zero;
        }
        if (self.on_request_end != .zero) {
            self.on_request_end.unprotect();
            self.on_request_end = .zero;
        }
        if (self.on_request_error != .zero) {
            self.on_request_error.unprotect();
            self.on_request_error = .zero;
        }
        if (self.on_response_start != .zero) {
            self.on_response_start.unprotect();
            self.on_response_start = .zero;
        }
        if (self.on_response_headers != .zero) {
            self.on_response_headers.unprotect();
            self.on_response_headers = .zero;
        }
        if (self._node_binding != .zero) {
            self._node_binding.unprotect();
            self._node_binding = .zero;
        }
        if (self._context_storage != .zero) {
            self._context_storage.unprotect();
            self._context_storage = .zero;
        }

        for (self.copy2response_headers) |header| {
            header.deref();
        }
        if (self.copy2response_headers.len > 0) {
            bun.default_allocator.free(self.copy2response_headers);
            self.copy2response_headers = &.{};
        }

        self.enabled = false;
        self.configured = false;
        logger("Telemetry reset", .{});
    }

    /// Shared helper to call a callback and inject headers into FetchHeaders
    /// Used by both response correlation headers and fetch distributed tracing
    fn callAndInjectHeaders(
        callback: JSValue,
        header_names: []const bun.String,
        headers: *WebCore.FetchHeaders,
        global: *JSGlobalObject,
        args: []const JSValue,
        comptime log_prefix: []const u8,
    ) void {
        const callback_result = callback.call(
            global,
            .js_undefined,
            args,
        ) catch |err| {
            _ = global.takeException(err);
            return;
        };

        // Handle undefined/null return (common case: no headers to inject)
        if (callback_result == .zero or callback_result.isUndefinedOrNull()) {
            return;
        }

        // Validate it's an array
        if (!callback_result.jsType().isArray()) {
            return;
        }

        const values_len = callback_result.getLength(global) catch return;

        // Length must match configured headers (values array should match header names array)
        if (values_len != header_names.len) {
            logger("{s} values length ({d}) != configured header names ({d}); skipping injection", .{ log_prefix, values_len, header_names.len });
            return;
        }

        // Inject headers using pre-parsed names
        for (header_names, 0..) |header_name, i| {
            const value_js = callback_result.getIndex(global, @intCast(i)) catch continue;
            const value = bun.String.fromJS(value_js, global) catch continue;
            defer value.deref();

            var name_zig = header_name.toZigString();
            var value_zig = value.toZigString();
            headers.append(&name_zig, &value_zig, global);
        }
    }

    /// Shared helper to parse header name arrays from JS
    fn parseHeaderNames(
        self: *Self,
        array_js: JSValue,
        old_headers: []const bun.String,
    ) ![]const bun.String {
        if (!array_js.jsType().isArray()) {
            return &.{};
        }

        const array_len = array_js.getLength(self.global) catch 0;
        if (array_len == 0) {
            return &.{};
        }

        // Allocate header names array
        const headers = bun.default_allocator.alloc(bun.String, array_len) catch {
            return self.global.throwOutOfMemory();
        };
        errdefer bun.default_allocator.free(headers);

        // Parse header names from JS array
        var parsed_count: usize = 0;
        for (0..array_len) |i| {
            const name_js = array_js.getIndex(self.global, @intCast(i)) catch continue;
            const name = bun.String.fromJS(name_js, self.global) catch continue;
            headers[parsed_count] = name;
            parsed_count += 1;
        }

        // Clean up old array if it exists
        for (old_headers) |header| {
            header.deref();
        }
        if (old_headers.len > 0) {
            bun.default_allocator.free(old_headers);
        }

        // Return new array (may be smaller if some parsing failed)
        if (parsed_count > 0) {
            return headers[0..parsed_count];
        } else {
            bun.default_allocator.free(headers);
            return &.{};
        }
    }

    /// Configure telemetry with JavaScript callbacks
    pub fn configure(self: *Self, options: JSValue) !void {
        // Handle reset: configure(null) clears all callbacks and allows reconfiguration
        if (options.isNull() or options.isUndefined()) {
            self.reset();
            return;
        }

        if (!options.isObject()) {
            return self.global.throwInvalidArguments("Telemetry options must be an object or null", .{});
        }

        // Guard against double configuration
        if (self.configured) {
            return self.global.throwInvalidArguments("Telemetry already configured. Call Bun.telemetry.configure(null) to reset first.", .{});
        }

        // Parse onRequestStart callback
        if (try options.getTruthyComptime(self.global, "onRequestStart")) |callback| {
            if (!callback.isCallable()) {
                return self.global.throwInvalidArguments("onRequestStart must be a function", .{});
            }

            // Unprotect old callback if it exists
            if (self.on_request_start != .zero) {
                self.on_request_start.unprotect();
            }

            const protected = callback.withAsyncContextIfNeeded(self.global);
            protected.protect();
            self.on_request_start = protected;
        }

        // Parse onRequestEnd callback
        if (try options.getTruthyComptime(self.global, "onRequestEnd")) |callback| {
            if (!callback.isCallable()) {
                return self.global.throwInvalidArguments("onRequestEnd must be a function", .{});
            }

            if (self.on_request_end != .zero) {
                self.on_request_end.unprotect();
            }

            const protected = callback.withAsyncContextIfNeeded(self.global);
            protected.protect();
            self.on_request_end = protected;
        }

        // Parse onRequestError callback
        if (try options.getTruthyComptime(self.global, "onRequestError")) |callback| {
            if (!callback.isCallable()) {
                return self.global.throwInvalidArguments("onRequestError must be a function", .{});
            }

            if (self.on_request_error != .zero) {
                self.on_request_error.unprotect();
            }

            const protected = callback.withAsyncContextIfNeeded(self.global);
            protected.protect();
            self.on_request_error = protected;
        }

        // Parse onResponseStart callback
        if (try options.getTruthyComptime(self.global, "onResponseStart")) |callback| {
            if (!callback.isCallable()) {
                return self.global.throwInvalidArguments("onResponseStart must be a function", .{});
            }

            if (self.on_response_start != .zero) {
                self.on_response_start.unprotect();
            }

            const protected = callback.withAsyncContextIfNeeded(self.global);
            protected.protect();
            self.on_response_start = protected;
        }

        // Parse correlationHeaderNames array
        // If we add traceid and traceparent etc to fast headers, we can optimize this further
        if (try options.getTruthyComptime(self.global, "correlationHeaderNames")) |header_names_array| {
            self.copy2response_headers = try self.parseHeaderNames(header_names_array, self.copy2response_headers);
        }

        // Parse onResponseHeaders callback
        if (try options.getTruthyComptime(self.global, "onResponseHeaders")) |callback| {
            if (!callback.isCallable()) {
                return self.global.throwInvalidArguments("onResponseHeaders must be a function", .{});
            }

            if (self.on_response_headers != .zero) {
                self.on_response_headers.unprotect();
            }

            const protected = callback.withAsyncContextIfNeeded(self.global);
            protected.protect();
            self.on_response_headers = protected;
        }

        // Parse _node_binding object (for Node.js http.Server compatibility)
        if (try options.getTruthyComptime(self.global, "_node_binding")) |binding| {
            if (!binding.isObject()) {
                return self.global.throwInvalidArguments("_node_binding must be an object", .{});
            }

            if (self._node_binding != .zero) {
                self._node_binding.unprotect();
            }

            binding.protect();
            self._node_binding = binding;
        }

        // Parse _contextStorage (AsyncLocalStorage instance for context propagation)
        if (try options.getTruthyComptime(self.global, "_contextStorage")) |storage| {
            if (!storage.isObject()) {
                return self.global.throwInvalidArguments("_contextStorage must be an AsyncLocalStorage instance", .{});
            }

            if (self._context_storage != .zero) {
                self._context_storage.unprotect();
            }

            storage.protect();
            self._context_storage = storage;
        }

        // Enable telemetry if any callbacks or _node_binding are set
        self.enabled = self.on_request_start != .zero or
            self.on_request_end != .zero or
            self.on_request_error != .zero or
            self.on_response_start != .zero or
            self.on_response_headers != .zero or
            self._node_binding != .zero;

        // Require at least one callback to avoid sticky configured state
        if (!self.enabled) {
            return self.global.throwInvalidArguments("Telemetry.configure: provide at least one callback (onRequestStart, onRequestEnd, onRequestError, onResponseStart, onResponseHeaders, or _node_binding)", .{});
        }

        // Mark as configured
        self.configured = true;
        logger("Telemetry enabled", .{});
    }

    /// Called when a request starts
    /// Returns the request ID that should be used for subsequent calls
    pub fn notifyRequestStart(self: *Self, request_js: JSValue) RequestId {
        // Return sentinel (0) only when telemetry is completely disabled
        if (!self.enabled) {
            return 0; // 0 is a valid sentinel for "not tracked"
        }

        // Always generate an ID if telemetry is enabled
        // This allows response-only telemetry (onResponseHeaders without onRequestStart)
        const id = self.generateRequestId();

        // Only call the callback if it's configured
        if (self.on_request_start != .zero) {
            const id_js = jsRequestId(id);

            _ = self.on_request_start.call(
                self.global,
                .js_undefined,
                &.{ id_js, request_js },
            ) catch |err|
                self.global.takeException(err);
        }

        return id;
    }

    /// Called when a request ends successfully
    pub fn notifyRequestEnd(self: *Self, id: RequestId) void {
        if (!self.enabled or self.on_request_end == .zero) {
            return;
        }

        const id_js = jsRequestId(id);

        _ = self.on_request_end.call(
            self.global,
            .js_undefined,
            &.{id_js},
        ) catch |err|
            self.global.takeException(err);
    }

    /// Called when a request encounters an error
    pub fn notifyRequestError(self: *Self, id: RequestId, error_js: JSValue) void {
        if (!self.enabled or self.on_request_error == .zero) {
            return;
        }

        const id_js = jsRequestId(id);

        _ = self.on_request_error.call(
            self.global,
            .js_undefined,
            &.{ id_js, error_js },
        ) catch |err|
            self.global.takeException(err);
    }

    /// Check if telemetry is enabled
    pub inline fn isEnabled(self: *const Self) bool {
        return self.enabled;
    }

    /// Create a response builder for collecting telemetry data
    /// Returns null if telemetry is disabled (zero-cost when off)
    pub fn responseBuilder(self: *Self, request_id: RequestId) ?*ResponseBuilder {
        // Return null if telemetry is disabled or no response callback
        if (!self.enabled or self.on_response_headers == .zero) {
            return null;
        }
        const builder = bun.default_allocator.create(ResponseBuilder) catch {
            return null;
        };

        builder.* = .{
            .request_id = request_id,
            .global = self.global,
            .telemetry = self,
        };

        return builder;
    }
};

/// JavaScript API: Bun.telemetry.configure(options)
pub fn configure(globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return globalObject.throwNotEnoughArguments("configure", 1, 0);
    }

    const telemetry = try Telemetry.init(globalObject);
    try telemetry.configure(arguments.ptr[0]);

    return .js_undefined;
}

/// JavaScript API: Bun.telemetry.isEnabled()
pub fn isEnabled(_: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    if (Telemetry.getInstance()) |telemetry| {
        return JSValue.jsBoolean(telemetry.isEnabled());
    }
    return .false;
}

/// JavaScript API: Bun.telemetry.disable()
pub fn disable(_: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    if (Telemetry.getInstance()) |telemetry| {
        telemetry.reset();
    }
    return .js_undefined;
}

/// JavaScript API: Bun.telemetry._node_binding()
/// Returns the _node_binding object set via configure(), or undefined if not set
pub fn getNodeBinding(_: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    if (Telemetry.getInstance()) |telemetry| {
        if (telemetry._node_binding != .zero) {
            return telemetry._node_binding;
        }
    }
    return .js_undefined;
}

/// JavaScript API: Bun.telemetry.generateRequestId()
/// Generates a unique request ID for use in telemetry tracking
/// This is exposed to allow Node.js compatibility layer to generate IDs
pub fn jsGenerateRequestId(globalObject: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const telemetry = try Telemetry.init(globalObject);
    const id = telemetry.generateRequestId();
    return jsRequestId(id);
}

// Utility: convert a RequestId to a JavaScript number value
// Inline so the compiler can optimize away the wrapper.
// Note: RequestId is u64, JS numbers are safe to 2^53-1 (Number.MAX_SAFE_INTEGER).
// At 1M requests/sec, would take ~285 years to overflow. Counter resets per-process.
// This is observability data, not a critical distributed ID. Behavior beyond 2^53-1
// is same as `id & 0x1FFFFFFFFFFFFF` (precision loss), which is acceptable for this use case.
pub inline fn jsRequestId(id: RequestId) JSValue {
    return JSValue.jsNumber(@as(f64, @floatFromInt(id)));
}

// Utility: parse a RequestId from a JavaScript value with validation
// Ensures the value is a finite, positive, safe integer (1 to 2^53-1).
pub fn requestIdFromJS(globalObject: *JSGlobalObject, value: JSValue) bun.JSError!RequestId {
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
// Telemetry Context - AsyncLocalStorage-based request context
// ============================================================================
// AsyncLocalStorage Direct Integration
// Calls AsyncLocalStorage.enterWith() and .disable() directly from Zig
// No C++ bridge or internal module needed!
// ============================================================================

/// Enter telemetry context for a request by calling AsyncLocalStorage.enterWith()
/// This sets up AsyncLocalStorage for the current request lifecycle.
/// Should be called at the start of HTTP request handling.
///
/// @param globalObject The JavaScript global object
/// @param request_id The unique request identifier
pub fn enterContext(
    globalObject: *JSGlobalObject,
    request_id: RequestId,
) void {
    const telemetry = Telemetry.getInstance() orelse return;

    // Fast path: no context storage configured
    if (telemetry._context_storage == .zero) {
        return;
    }

    // Get the enterWith method from AsyncLocalStorage
    const enter_with_maybe = telemetry._context_storage.get(globalObject, "enterWith") catch return;
    const enter_with = enter_with_maybe orelse return;
    if (!enter_with.isCallable()) {
        return;
    }

    // Create context object: { requestId: <id> }
    const context_obj = JSValue.createEmptyObject(globalObject, 1);
    const id_js = jsRequestId(request_id);
    _ = context_obj.put(globalObject, "requestId", id_js);

    // Call storage.enterWith(context)
    _ = enter_with.call(
        globalObject,
        telemetry._context_storage, // 'this' context for the method call
        &.{context_obj},
    ) catch |err| {
        _ = globalObject.takeException(err);
    };
}

/// Exit telemetry context for a request by calling AsyncLocalStorage.disable()
/// This clears AsyncLocalStorage for the current request.
/// Should be called at the end of HTTP request handling.
///
/// @param globalObject The JavaScript global object
pub fn exitContext(globalObject: *JSGlobalObject) void {
    const telemetry = Telemetry.getInstance() orelse return;

    if (telemetry._context_storage == .zero) {
        return;
    }

    // Get the disable method from AsyncLocalStorage
    const disable_fn_maybe = telemetry._context_storage.get(globalObject, "disable") catch return;
    const disable_fn = disable_fn_maybe orelse return;
    if (!disable_fn.isCallable()) {
        return;
    }

    // Call storage.disable()
    _ = disable_fn.call(
        globalObject,
        telemetry._context_storage,
        &.{},
    ) catch |err| {
        _ = globalObject.takeException(err);
    };
}
