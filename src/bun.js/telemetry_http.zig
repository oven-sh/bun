const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const telemetry = @import("telemetry.zig");
const AttributeMap = telemetry.AttributeMap;
const AttributeKey = telemetry.AttributeKey;

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
    global: *JSGlobalObject,
    request_id: u64,
    method: []const u8,
    url: []const u8,
    headers: ?JSValue,
) AttributeMap {
    var attrs = AttributeMap.init(global);

    // Operation metadata
    attrs.set("operation.id", JSValue.jsNumber(@as(f64, @floatFromInt(request_id))));

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
