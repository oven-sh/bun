const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const telemetry = @import("telemetry.zig");
const AttributeMap = telemetry.AttributeMap;
const AttributeKey = telemetry.AttributeKey;

/// Build fetch request start attributes following OpenTelemetry semantic conventions
///
/// Reference: specs/001-opentelemetry-support/tasks.md T033
/// Reference: specs/001-opentelemetry-support/data-model.md lines 280-304
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
pub fn buildFetchStartAttributes(
    global: *JSGlobalObject,
    request_id: u64,
    method: []const u8,
    url: []const u8,
    headers: ?JSValue,
) AttributeMap {
    var attrs = AttributeMap.init(global);

    // Operation metadata
    attrs.set("operation.id", telemetry.jsRequestId(request_id));

    // Timestamp: nanoseconds since epoch
    const timestamp_ns = std.time.nanoTimestamp();
    attrs.set("operation.timestamp", JSValue.jsNumber(@as(f64, @floatFromInt(timestamp_ns))));

    // HTTP method
    attrs.fastSet(.http_request_method, ZigString.init(method).toJS(global));

    // URL components
    attrs.set("url.full", ZigString.init(url).toJS(global));

    // Parse URL to extract components
    if (parseURL(url)) |url_parts| {
        if (url_parts.path.len > 0) {
            attrs.fastSet(.url_path, ZigString.init(url_parts.path).toJS(global));
        }
        if (url_parts.query.len > 0) {
            attrs.fastSet(.url_query, ZigString.init(url_parts.query).toJS(global));
        }
        attrs.set("url.scheme", ZigString.init(url_parts.scheme).toJS(global));
        attrs.fastSet(.server_address, ZigString.init(url_parts.host).toJS(global));
        if (url_parts.port) |port| {
            attrs.fastSet(.server_port, JSValue.jsNumber(@as(f64, @floatFromInt(port))));
        }
    }

    // Outgoing request headers (if provided)
    // TODO: Implement header iteration when JSValue API is available
    _ = headers; // Suppress unused variable warning

    return attrs;
}

/// Build fetch response end attributes following OpenTelemetry semantic conventions
///
/// Reference: specs/001-opentelemetry-support/tasks.md T034
///
/// Attributes included:
/// - http.response.status_code: number
/// - http.response.body.size: number
/// - operation.duration: number (nanoseconds)
/// - http.response.header.*: string (if configured)
pub fn buildFetchEndAttributes(
    global: *JSGlobalObject,
    start_timestamp_ns: u64,
    status_code: u16,
    content_length: u64,
    headers: ?JSValue,
) AttributeMap {
    var attrs = AttributeMap.init(global);

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

/// Build fetch error attributes following OpenTelemetry semantic conventions
///
/// Reference: specs/001-opentelemetry-support/tasks.md T035
///
/// Attributes included:
/// - error.type: string (NetworkError, TimeoutError, DNSError, TLSError)
/// - error.message: string
/// - error.stack_trace: string (if available)
/// - http.response.status_code: number (if response was received)
/// - operation.duration: number (nanoseconds)
pub fn buildFetchErrorAttributes(
    global: *JSGlobalObject,
    start_timestamp_ns: u64,
    error_type: []const u8,
    error_message: []const u8,
    stack_trace: ?[]const u8,
    status_code: ?u16,
) AttributeMap {
    var attrs = AttributeMap.init(global);

    // Error information
    attrs.fastSet(.error_type, ZigString.init(error_type).toJS(global));
    attrs.fastSet(.error_message, ZigString.init(error_message).toJS(global));

    if (stack_trace) |stack| {
        attrs.set("error.stack_trace", ZigString.init(stack).toJS(global));
    }

    // Status code if response was received
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

// Test helpers
test "parseURL basic" {
    const url1 = "http://api.example.com:8080/v1/users?page=2";
    const parts1 = parseURL(url1).?;

    try std.testing.expectEqualStrings("http", parts1.scheme);
    try std.testing.expectEqualStrings("api.example.com", parts1.host);
    try std.testing.expectEqual(@as(u16, 8080), parts1.port.?);
    try std.testing.expectEqualStrings("/v1/users", parts1.path);
    try std.testing.expectEqualStrings("page=2", parts1.query);
}

test "parseURL https default port" {
    const url = "https://secure.example.com/api";
    const parts = parseURL(url).?;

    try std.testing.expectEqualStrings("https", parts.scheme);
    try std.testing.expectEqualStrings("secure.example.com", parts.host);
    try std.testing.expectEqual(@as(u16, 443), parts.port.?);
    try std.testing.expectEqualStrings("/api", parts.path);
    try std.testing.expectEqual(@as(usize, 0), parts.query.len);
}

// ============================================================================
// High-level helpers for minimal fetch.zig integration
// ============================================================================

const http = @import("../http.zig");
const Method = http.Method;

/// Notify telemetry of fetch operation start. Returns request_id if telemetry enabled, null otherwise.
/// Call from fetch.zig queue() function - single-line integration point.
pub fn notifyFetchStart(
    global: *JSGlobalObject,
    method: Method,
    url: []const u8,
    headers: ?JSValue,
) ?u64 {
    if (telemetry.getGlobalTelemetry()) |telemetry_instance| {
        if (telemetry_instance.isEnabledFor(.fetch)) {
            const request_id = telemetry_instance.generateRequestId();
            const method_str = @tagName(method);
            var start_attrs = buildFetchStartAttributes(global, request_id, method_str, url, headers);
            telemetry_instance.notifyOperationStart(.fetch, request_id, start_attrs.toJS());
            return request_id;
        }
    }
    return null;
}

/// Notify telemetry of fetch operation end.
/// Call from fetch.zig onResolve() - single-line integration point.
pub fn notifyFetchEnd(
    global: *JSGlobalObject,
    request_id: u64,
    start_time_ns: u64,
    metadata: ?http.HTTPResponseMetadata,
    body: ?*bun.MutableString,
) void {
    if (request_id == 0) return;
    if (telemetry.getGlobalTelemetry()) |telemetry_instance| {
        const status_code: u16 = if (metadata) |m| @truncate(m.response.status_code) else 200;
        const content_length: u64 = if (body) |b| b.list.items.len else 0;
        var end_attrs = buildFetchEndAttributes(global, start_time_ns, status_code, content_length, null);
        telemetry_instance.notifyOperationEnd(.fetch, request_id, end_attrs.toJS());
    }
}

/// Notify telemetry of fetch operation error.
/// Call from fetch.zig onReject() - single-line integration point.
pub fn notifyFetchError(
    global: *JSGlobalObject,
    request_id: u64,
    start_time_ns: u64,
    fail_error: ?anyerror,
    error_message: bun.String,
    metadata: ?http.HTTPResponseMetadata,
) void {
    if (request_id == 0) return;
    if (telemetry.getGlobalTelemetry()) |telemetry_instance| {
        const error_type_str = if (fail_error) |err| @errorName(err) else "FetchError";
        const error_message_str = error_message.toUTF8(bun.default_allocator);
        defer error_message_str.deinit();
        var error_attrs = buildFetchErrorAttributes(
            global,
            start_time_ns,
            error_type_str,
            error_message_str.slice(),
            null,
            if (metadata) |m| @as(u16, @truncate(m.response.status_code)) else null,
        );
        telemetry_instance.notifyOperationError(.fetch, request_id, error_attrs.toJS());
    }
}
