const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

const logger = bun.Output.scoped(.telemetry, .visible);

/// Request ID type - using u64 for simplicity and performance
/// This is similar to how Node.js handles timer IDs
pub const RequestId = u64;

/// Global telemetry instance
var instance: ?*Telemetry = null;

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

    /// Configure telemetry with JavaScript callbacks
    pub fn configure(self: *Self, options: JSValue) !void {
        if (!options.isObject()) {
            return self.global.throwInvalidArguments("Telemetry options must be an object", .{});
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
        telemetry.enabled = false;

        // Clear callbacks
        if (telemetry.on_request_start != .zero) {
            telemetry.on_request_start.unprotect();
            telemetry.on_request_start = .zero;
        }
        if (telemetry.on_request_end != .zero) {
            telemetry.on_request_end.unprotect();
            telemetry.on_request_end = .zero;
        }
        if (telemetry.on_request_error != .zero) {
            telemetry.on_request_error.unprotect();
            telemetry.on_request_error = .zero;
        }
        if (telemetry.on_response_headers != .zero) {
            telemetry.on_response_headers.unprotect();
            telemetry.on_response_headers = .zero;
        }
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

// Utility: convert a RequestId-ish integer to a JavaScript number value
// Inline so the compiler can optimize away the wrapper. Accepts any integer type.
inline fn jsRequestId(id: anytype) JSValue {
    return JSValue.jsNumber(@as(f64, @floatFromInt(id)));
}
