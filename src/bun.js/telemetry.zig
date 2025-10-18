const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const WebCore = bun.jsc.WebCore;

const logger = bun.Output.scoped(.telemetry, .visible);

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
        if (headers_js != .zero and headers_js != .js_undefined) {
            headers_js.protect();
            // Unprotect old headers if we had any
            if (self.headers_js != .zero) {
                self.headers_js.unprotect();
            }
            self.headers_js = headers_js;
        }
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
    on_response_headers: JSValue = .zero,

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
        if (self.on_response_headers != .zero) {
            self.on_response_headers.unprotect();
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
        if (self.on_response_headers != .zero) {
            self.on_response_headers.unprotect();
            self.on_response_headers = .zero;
        }

        self.enabled = false;
        self.configured = false;
        logger("Telemetry reset", .{});
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

        // Enable telemetry if any callbacks are set
        self.enabled = self.on_request_start != .zero or
            self.on_request_end != .zero or
            self.on_request_error != .zero or
            self.on_response_headers != .zero;

        // Mark as configured
        self.configured = true;

        if (self.enabled) {
            logger("Telemetry enabled", .{});
        }
    }

    /// Called when a request starts
    /// Returns the request ID that should be used for subsequent calls
    pub fn notifyRequestStart(self: *Self, request_js: JSValue) RequestId {
        const id = self.generateRequestId();

        if (!self.enabled or self.on_request_start == .zero) {
            return id;
        }

        const id_js = jsRequestId(id);

        _ = self.on_request_start.call(
            self.global,
            .js_undefined,
            &.{ id_js, request_js },
        ) catch |err|
            self.global.takeException(err);

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

    /// Called when response headers are about to be sent (with status code and content length)
    pub fn notifyResponseStatus(self: *Self, id: RequestId, status_code: u16, content_length: u64) void {
        if (!self.enabled or self.on_response_headers == .zero) {
            return;
        }

        const id_js = jsRequestId(id);
        const status_js = JSValue.jsNumber(@as(f64, @floatFromInt(status_code)));
        const content_length_js = JSValue.jsNumber(@as(f64, @floatFromInt(content_length)));

        _ = self.on_response_headers.call(
            self.global,
            .js_undefined,
            &.{ id_js, status_js, content_length_js },
        ) catch |err|
            self.global.takeException(err);
    }

    /// Called when response headers are about to be sent (with headers object)
    /// Headers are protected during the callback and unprotected after
    pub fn notifyResponseStatusWithHeaders(self: *Self, id: RequestId, status_code: u16, content_length: u64, headers_js: JSValue) void {
        if (!self.enabled or self.on_response_headers == .zero) {
            return;
        }

        const id_js = jsRequestId(id);
        const status_js = JSValue.jsNumber(@as(f64, @floatFromInt(status_code)));
        const content_length_js = JSValue.jsNumber(@as(f64, @floatFromInt(content_length)));

        // Protect headers during callback execution
        if (headers_js != .js_undefined and headers_js != .null) {
            headers_js.protect();
        }
        defer {
            if (headers_js != .js_undefined and headers_js != .null) {
                headers_js.unprotect();
            }
        }

        _ = self.on_response_headers.call(
            self.global,
            .js_undefined,
            &.{ id_js, status_js, content_length_js, headers_js },
        ) catch |err|
            self.global.takeException(err);
    }

    /// Called when response headers are about to be sent (full Response object)
    /// WARNING: This has lifecycle issues and is currently disabled
    pub fn notifyResponseHeaders(self: *Self, id: RequestId, response_js: JSValue) void {
        if (!self.enabled or self.on_response_headers == .zero) {
            return;
        }

        const id_js = jsRequestId(id);

        _ = self.on_response_headers.call(
            self.global,
            .js_undefined,
            &.{ id_js, response_js },
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

        // Allocate and initialize the builder
        const builder = bun.default_allocator.create(ResponseBuilder) catch {
            // If allocation fails, silently fail telemetry
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
pub fn configure(global: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return global.throwNotEnoughArguments("configure", 1, 0);
    }

    const telemetry = try Telemetry.init(global);
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

/// JavaScript API: Bun.telemetry.generateRequestId()
/// Generates a unique request ID for use in telemetry tracking
/// This is exposed to allow Node.js compatibility layer to generate IDs
pub fn jsGenerateRequestId(global: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const telemetry = try Telemetry.init(global);
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
