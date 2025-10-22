const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const telemetry = @import("telemetry.zig");
const AttributeMap = telemetry.AttributeMap;
const AttributeKey = telemetry.AttributeKey;

/// Context for tracking HTTP request telemetry state
pub const HttpTelemetryContext = struct {
    request_id: u64 = 0,
    start_time_ns: u64 = 0,

    pub inline fn isEnabled(self: *const HttpTelemetryContext) bool {
        return self.request_id != 0;
    }

    pub inline fn reset(self: *HttpTelemetryContext) void {
        self.request_id = 0;
        self.start_time_ns = 0;
    }
};

/// Build HTTP request start attributes following OpenTelemetry semantic conventions v1.23.0+
///
/// Reference: specs/001-opentelemetry-support/contracts/hook-lifecycle.md lines 296-322
/// Reference: specs/001-opentelemetry-support/data-model.md lines 254-278
///
/// Attributes included:
/// - operation.id: number
/// - operation.timestamp: number (nanoseconds since epoch)
/// - http.request.method: string
/// - url.full: string
/// - url.path: string
/// - url.query: string (if present)
/// - url.scheme: string
/// - server.address: string
/// - server.port: number
/// - http.request.header.*: string (if configured via captureAttributes)
/// - trace.parent.* (if traceparent header present)
pub fn buildHttpStartAttributes(
    globalObject: *JSGlobalObject,
    request_id: u64,
    method: []const u8,
    url: []const u8,
    headers: ?JSValue,
) AttributeMap {
    var attrs = AttributeMap.init(globalObject);

    // Operation metadata
    attrs.set("operation.id", telemetry.jsRequestId(request_id));

    // Timestamp: nanoseconds since epoch
    const timestamp_ns = std.time.nanoTimestamp();
    attrs.set("operation.timestamp", JSValue.jsNumber(@as(f64, @floatFromInt(timestamp_ns))));

    // HTTP method
    attrs.fastSet(.http_request_method, ZigString.init(method).toJS(globalObject));

    // URL components
    attrs.set("url.full", ZigString.init(url).toJS(globalObject));

    // Parse URL to extract components
    if (parseURL(url)) |url_parts| {
        if (url_parts.path.len > 0) {
            attrs.fastSet(.url_path, ZigString.init(url_parts.path).toJS(globalObject));
        }
        if (url_parts.query.len > 0) {
            attrs.fastSet(.url_query, ZigString.init(url_parts.query).toJS(globalObject));
        }
        attrs.set("url.scheme", ZigString.init(url_parts.scheme).toJS(globalObject));
        attrs.fastSet(.server_address, ZigString.init(url_parts.host).toJS(globalObject));
        if (url_parts.port) |port| {
            attrs.fastSet(.server_port, JSValue.jsNumber(@as(f64, @floatFromInt(port))));
        }
    }

    // Request headers (if provided)
    // TODO: Implement header iteration when JSValue API is available
    _ = headers; // Suppress unused variable warning

    return attrs;
}

/// Build HTTP response end attributes following OpenTelemetry semantic conventions
///
/// Reference: specs/001-opentelemetry-support/contracts/hook-lifecycle.md lines 324-334
///
/// Attributes included:
/// - http.response.status_code: number
/// - http.response.body.size: number
/// - operation.duration: number (nanoseconds)
/// - http.response.header.*: string (if configured)
pub fn buildHttpEndAttributes(
    globalObject: *JSGlobalObject,
    start_timestamp_ns: u64,
    status_code: u16,
    content_length: u64,
    headers: ?JSValue,
) AttributeMap {
    var attrs = AttributeMap.init(globalObject);

    // HTTP response status
    attrs.fastSet(.http_response_status_code, JSValue.jsNumber(@as(f64, @floatFromInt(status_code))));

    // Response body size
    attrs.fastSet(.http_response_body_size, JSValue.jsNumber(@as(f64, @floatFromInt(content_length))));

    // Operation duration
    const end_timestamp_ns = std.time.nanoTimestamp();
    const duration_ns = @as(u64, @intCast(end_timestamp_ns - @as(i128, @intCast(start_timestamp_ns))));
    attrs.set("operation.duration", JSValue.jsNumber(@as(f64, @floatFromInt(duration_ns))));

    // Response headers (if provided and configured)
    // TODO: Implement header iteration when JSValue API is available
    _ = headers; // Suppress unused variable warning

    return attrs;
}

/// Build HTTP error attributes following OpenTelemetry semantic conventions
///
/// Reference: specs/001-opentelemetry-support/contracts/hook-lifecycle.md lines 336-346
///
/// Attributes included:
/// - error.type: string
/// - error.message: string
/// - error.stack_trace: string (if available)
/// - http.response.status_code: number (if response was sent)
/// - operation.duration: number (nanoseconds)
pub fn buildHttpErrorAttributes(
    globalObject: *JSGlobalObject,
    start_timestamp_ns: u64,
    error_type: []const u8,
    error_message: []const u8,
    stack_trace: ?[]const u8,
    status_code: ?u16,
) AttributeMap {
    var attrs = AttributeMap.init(globalObject);

    // Error information
    attrs.fastSet(.error_type, ZigString.init(error_type).toJS(globalObject));
    attrs.fastSet(.error_message, ZigString.init(error_message).toJS(globalObject));

    if (stack_trace) |stack| {
        attrs.set("error.stack_trace", ZigString.init(stack).toJS(globalObject));
    }

    // Status code if response was sent
    if (status_code) |code| {
        attrs.fastSet(.http_response_status_code, JSValue.jsNumber(@as(f64, @floatFromInt(code))));
    }

    // Operation duration
    const end_timestamp_ns = std.time.nanoTimestamp();
    const duration_ns = @as(u64, @intCast(end_timestamp_ns - @as(i128, @intCast(start_timestamp_ns))));
    attrs.set("operation.duration", JSValue.jsNumber(@as(f64, @floatFromInt(duration_ns))));

    return attrs;
}

/// Parse a URL string into components
/// Simple parser for extracting scheme, host, port, path, query
fn parseURL(url: []const u8) ?URLParts {
    // Look for scheme
    var scheme: []const u8 = "http";
    var remainder = url;

    if (std.mem.indexOf(u8, url, "://")) |scheme_end| {
        scheme = url[0..scheme_end];
        remainder = url[scheme_end + 3 ..];
    }

    // Find the start of the path (first /)
    const path_start = std.mem.indexOf(u8, remainder, "/") orelse remainder.len;
    const host_and_port = remainder[0..path_start];
    const path_and_query = if (path_start < remainder.len) remainder[path_start..] else "/";

    // Parse host and port
    var host = host_and_port;
    var port: ?u16 = null;

    if (std.mem.lastIndexOf(u8, host_and_port, ":")) |port_colon| {
        host = host_and_port[0..port_colon];
        const port_str = host_and_port[port_colon + 1 ..];
        port = std.fmt.parseInt(u16, port_str, 10) catch null;
    }

    // Set default port if not specified
    if (port == null) {
        if (std.mem.eql(u8, scheme, "https")) {
            port = 443;
        } else {
            port = 80;
        }
    }

    // Parse path and query
    var path = path_and_query;
    var query: []const u8 = "";

    if (std.mem.indexOf(u8, path_and_query, "?")) |query_start| {
        path = path_and_query[0..query_start];
        query = path_and_query[query_start + 1 ..];
    }

    return URLParts{
        .scheme = scheme,
        .host = host,
        .port = port,
        .path = path,
        .query = query,
    };
}

const URLParts = struct {
    scheme: []const u8,
    host: []const u8,
    port: ?u16,
    path: []const u8,
    query: []const u8,
};

// Test helpers (for native tests in test/js/bun/telemetry/)
test "parseURL basic" {
    const url1 = "http://localhost:3000/api/users?limit=10";
    const parts1 = parseURL(url1).?;

    try std.testing.expectEqualStrings("http", parts1.scheme);
    try std.testing.expectEqualStrings("localhost", parts1.host);
    try std.testing.expectEqual(@as(u16, 3000), parts1.port.?);
    try std.testing.expectEqualStrings("/api/users", parts1.path);
    try std.testing.expectEqualStrings("limit=10", parts1.query);
}

test "parseURL no query" {
    const url = "https://example.com/path";
    const parts = parseURL(url).?;

    try std.testing.expectEqualStrings("https", parts.scheme);
    try std.testing.expectEqualStrings("example.com", parts.host);
    try std.testing.expectEqual(@as(u16, 443), parts.port.?);
    try std.testing.expectEqualStrings("/path", parts.path);
    try std.testing.expectEqual(@as(usize, 0), parts.query.len);
}

// ============================================================================
// High-Level Notification Helpers (minimize changes to core Bun code)
// ============================================================================

/// Notify HTTP request start - call this AFTER URL is available, BEFORE user handler
/// Returns initialized context for tracking this request
pub inline fn notifyHttpRequestStart(
    ctx: *HttpTelemetryContext,
    globalObject: *JSGlobalObject,
    method: []const u8,
    url: []const u8,
) void {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;
    if (!telemetry_inst.isEnabledFor(.http)) return;

    // Generate unique request ID and store timestamp
    ctx.request_id = telemetry_inst.generateRequestId();
    ctx.start_time_ns = @intCast(std.time.nanoTimestamp());

    // Build and send start attributes
    var start_attrs = buildHttpStartAttributes(globalObject, ctx.request_id, method, url, null);
    telemetry_inst.notifyOperationStart(.http, ctx.request_id, start_attrs.toJS());
}

/// Notify HTTP request error - extracts error details from JSValue
pub inline fn notifyHttpRequestError(
    ctx: *const HttpTelemetryContext,
    globalObject: *JSGlobalObject,
    error_value: JSValue,
) void {
    if (!ctx.isEnabled()) return;
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Extract error information from JSValue
    var error_type: []const u8 = "InternalError";
    var error_message: []const u8 = "Request handler rejected";
    var stack_trace: ?[]const u8 = null;

    if (!error_value.isEmptyOrUndefinedOrNull()) {
        // Try to get error message
        if (error_value.get(globalObject, "message") catch null) |msg_val| {
            if (msg_val.isString()) {
                var msg_str: ZigString = undefined;
                msg_val.toZigString(&msg_str, globalObject) catch {};
                if (msg_str.len > 0) {
                    const msg_slice = msg_str.toSlice(bun.default_allocator);
                    error_message = msg_slice.slice();
                }
            }
        }

        // Try to get error type (from constructor name)
        var class_name_str: ZigString = undefined;
        error_value.getClassName(globalObject, &class_name_str) catch {};
        if (class_name_str.len > 0) {
            const class_name_slice = class_name_str.toSlice(bun.default_allocator);
            error_type = class_name_slice.slice();
        }

        // Try to get stack trace
        if (error_value.get(globalObject, "stack") catch null) |stack_val| {
            if (stack_val.isString()) {
                var stack_str: ZigString = undefined;
                stack_val.toZigString(&stack_str, globalObject) catch {};
                if (stack_str.len > 0) {
                    const stack_slice = stack_str.toSlice(bun.default_allocator);
                    stack_trace = stack_slice.slice();
                }
            }
        }
    }

    // Build and send error attributes
    var error_attrs = buildHttpErrorAttributes(globalObject, ctx.start_time_ns, error_type, error_message, stack_trace, null);
    telemetry_inst.notifyOperationError(.http, ctx.request_id, error_attrs.toJS());
}

/// Notify HTTP request end - call this in finalizeWithoutDeinit
/// Automatically resets the context to prevent double-cleanup
pub inline fn notifyHttpRequestEnd(
    ctx: *HttpTelemetryContext,
    globalObject: *JSGlobalObject,
    status_code: u16,
    content_length: u64,
) void {
    if (!ctx.isEnabled()) return;
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Build and send end attributes
    var end_attrs = buildHttpEndAttributes(globalObject, ctx.start_time_ns, status_code, content_length, null);
    telemetry_inst.notifyOperationEnd(.http, ctx.request_id, end_attrs.toJS());

    // CRITICAL: Reset to prevent double-cleanup
    ctx.reset();
}

// ============================================================================
// Header Injection/Propagation Helpers
// ============================================================================

/// Add propagation headers to HTTP response headers from instrumentation
/// Integration point for HTTP server distributed tracing header injection
/// Note: Fetch client header injection is handled in telemetry_fetch.zig
///
/// Usage in server.zig (HTTP response):
///   addPropagationHeaders(.http, req_id, data, response.headers, global);
///
/// The function:
/// 1. Calls notifyOperationInject to get header values from all instruments
/// 2. Reads configured header names from ConfigurationProperty
/// 3. Merges injected values into the headers object (linear concatenation)
pub inline fn addPropagationHeaders(
    comptime kind: telemetry.InstrumentKind,
    request_id: u64,
    data: JSValue,
    headers: *bun.webcore.FetchHeaders,
    globalObject: *JSGlobalObject,
) void {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;
    if (!telemetry_inst.isEnabledFor(kind)) return;

    // Only HTTP server responses supported here (fetch handled in telemetry_fetch.zig)
    const config_property_id: u8 = switch (kind) {
        .http => @intFromEnum(telemetry.ConfigurationProperty.http_propagate_headers_server_response),
        else => return,
    };

    // Get configured header names (array of strings or undefined)
    const header_names_js = telemetry_inst.getConfigurationProperty(config_property_id);
    if (header_names_js.isUndefined() or !header_names_js.isArray()) return;

    // Call all instruments to get header values
    const injected_values = telemetry_inst.notifyOperationInject(kind, request_id, data);
    if (injected_values.isUndefined() or !injected_values.isArray()) return;

    // Get length of arrays
    const header_names_len = header_names_js.getLength(globalObject) catch return;
    const injected_values_len = injected_values.getLength(globalObject) catch return;
    if (header_names_len == 0 or injected_values_len == 0) return;

    // Iterate through configured header names
    var i: u32 = 0;
    while (i < header_names_len) : (i += 1) {
        const header_name_js = header_names_js.getIndex(globalObject, i) catch continue;
        if (!header_name_js.isString()) continue;

        // Convert header name to ZigString
        var header_name_zig: ZigString = ZigString.Empty;
        header_name_js.toZigString(&header_name_zig, globalObject) catch continue;

        // Look up this header in all injected value objects
        // Using linear concatenation: iterate through all injected objects
        var j: u32 = 0;
        while (j < injected_values_len) : (j += 1) {
            const injected_obj = injected_values.getIndex(globalObject, j) catch continue;
            if (!injected_obj.isObject()) continue;

            // Get the header value from this injected object
            const header_value_js_opt = injected_obj.get(globalObject, header_name_zig.slice()) catch continue;
            const header_value_js = header_value_js_opt orelse continue;
            if (header_value_js.isUndefined() or header_value_js.isNull()) continue;
            if (!header_value_js.isString()) continue;

            // Convert header value to ZigString and append
            var header_value_zig: ZigString = ZigString.Empty;
            header_value_js.toZigString(&header_value_zig, globalObject) catch continue;

            // Append to headers (allows duplicates - linear concatenation)
            headers.append(&header_name_zig, &header_value_zig, globalObject);
        }
    }
}

/// Render injected trace headers to uWebSockets Response using stack-allocated buffers
/// MUST be called at the end of renderMetadata, after all other headers
pub inline fn renderInjectedTraceHeadersToUWSResponse(
    comptime kind: telemetry.InstrumentKind,
    request_id: u64,
    data: JSValue,
    resp: anytype, // uws Response
    globalObject: *JSGlobalObject,
) void {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;
    if (!telemetry_inst.isEnabledFor(kind)) return;

    const config_property_id: u8 = switch (kind) {
        .http => @intFromEnum(telemetry.ConfigurationProperty.http_propagate_headers_server_response),
        else => return,
    };

    // Get configured header names
    const header_names_js = telemetry_inst.getConfigurationProperty(config_property_id);
    if (header_names_js.isUndefined() or !header_names_js.isArray()) return;

    // Call all instruments to get header values
    const injected_values = telemetry_inst.notifyOperationInject(kind, request_id, data);
    if (injected_values.isUndefined() or !injected_values.isArray()) return;

    const header_names_len = header_names_js.getLength(globalObject) catch return;
    const injected_values_len = injected_values.getLength(globalObject) catch return;
    if (header_names_len == 0 or injected_values_len == 0) return;

    // Stack-allocated buffers for header name and value (matches content-range pattern)
    var header_name_buf: [256]u8 = undefined;
    var header_value_buf: [1024]u8 = undefined;

    // Iterate through configured header names
    var i: u32 = 0;
    while (i < header_names_len) : (i += 1) {
        const header_name_js = header_names_js.getIndex(globalObject, i) catch continue;
        if (!header_name_js.isString()) continue;

        // Copy header name to stack buffer
        var header_name_zig: ZigString = ZigString.Empty;
        header_name_js.toZigString(&header_name_zig, globalObject) catch continue;
        const header_name_len = @min(header_name_zig.len, header_name_buf.len);
        if (header_name_len == 0) continue;
        @memcpy(header_name_buf[0..header_name_len], header_name_zig.slice()[0..header_name_len]);
        const header_name_slice = header_name_buf[0..header_name_len];

        // Iterate through all injected value objects (linear concatenation)
        var j: u32 = 0;
        while (j < injected_values_len) : (j += 1) {
            const injected_obj = injected_values.getIndex(globalObject, j) catch continue;
            if (!injected_obj.isObject()) continue;

            const header_value_js_opt = injected_obj.get(globalObject, header_name_zig.slice()) catch continue;
            const header_value_js = header_value_js_opt orelse continue;
            if (header_value_js.isUndefined() or header_value_js.isNull()) continue;
            if (!header_value_js.isString()) continue;

            // Copy header value to stack buffer
            var header_value_zig: ZigString = ZigString.Empty;
            header_value_js.toZigString(&header_value_zig, globalObject) catch continue;
            const header_value_len = @min(header_value_zig.len, header_value_buf.len);
            if (header_value_len == 0) continue;
            @memcpy(header_value_buf[0..header_value_len], header_value_zig.slice()[0..header_value_len]);
            const header_value_slice = header_value_buf[0..header_value_len];

            // Write to uws Response using stack-allocated buffers
            resp.writeHeader(header_name_slice, header_value_slice);
        }
    }
}
