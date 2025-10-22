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
/// Also injects propagation headers into the request.
pub fn notifyFetchStart(
    globalObject: *JSGlobalObject,
    method: Method,
    url: []const u8,
    headers: ?JSValue,
    request_headers: *http.Headers, // NEW: mutable headers for injection
) ?u64 {
    if (telemetry.getGlobalTelemetry()) |telemetry_instance| {
        if (telemetry_instance.isEnabledFor(.fetch)) {
            const request_id = telemetry_instance.generateRequestId();
            const method_str = @tagName(method);
            var start_attrs = buildFetchStartAttributes(globalObject, request_id, method_str, url, headers);
            telemetry_instance.notifyOperationStart(.fetch, request_id, start_attrs.toJS());

            // Inject propagation headers (e.g., traceparent, tracestate)
            injectFetchHeaders(request_headers, request_id, globalObject);

            return request_id;
        }
    }
    return null;
}

/// Inject propagation headers into fetch request headers
/// Called internally by notifyFetchStart - no separate integration point needed
fn injectFetchHeaders(
    headers: *http.Headers,
    request_id: u64,
    globalObject: *JSGlobalObject,
) void {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Get configured header names
    const config_property_id = @intFromEnum(telemetry.ConfigurationProperty.http_propagate_headers_fetch_request);
    const header_names_js = telemetry_inst.getConfigurationProperty(config_property_id);
    if (header_names_js.isUndefined() or !header_names_js.isArray()) return;

    // Call all instruments to get header values
    const injected_values = telemetry_inst.notifyOperationInject(.fetch, request_id, .js_undefined);
    if (injected_values.isUndefined() or !injected_values.isArray()) return;

    // Get lengths
    const header_names_len = header_names_js.getLength(globalObject) catch return;
    const injected_values_len = injected_values.getLength(globalObject) catch return;
    if (header_names_len == 0 or injected_values_len == 0) return;

    // Iterate through configured header names
    var i: u32 = 0;
    while (i < header_names_len) : (i += 1) {
        const header_name_js = header_names_js.getIndex(globalObject, i) catch continue;
        if (!header_name_js.isString()) continue;

        // Convert header name to slice
        var header_name_zig: ZigString = ZigString.Empty;
        header_name_js.toZigString(&header_name_zig, globalObject) catch continue;
        const header_name_slice = header_name_zig.toSlice(bun.default_allocator);
        defer header_name_slice.deinit();

        // Look up this header in all injected value objects
        var j: u32 = 0;
        while (j < injected_values_len) : (j += 1) {
            const injected_obj = injected_values.getIndex(globalObject, j) catch continue;
            if (!injected_obj.isObject()) continue;

            // Get the header value from this injected object
            const header_value_js_opt = injected_obj.get(globalObject, header_name_slice.slice()) catch continue;
            const header_value_js = header_value_js_opt orelse continue;
            if (header_value_js.isUndefined() or header_value_js.isNull()) continue;
            if (!header_value_js.isString()) continue;

            // Convert header value to slice
            var header_value_zig: ZigString = ZigString.Empty;
            header_value_js.toZigString(&header_value_zig, globalObject) catch continue;
            const header_value_slice = header_value_zig.toSlice(bun.default_allocator);
            defer header_value_slice.deinit();

            // Append to headers (allows duplicates - linear concatenation)
            headers.append(header_name_slice.slice(), header_value_slice.slice()) catch {
                std.debug.print("Telemetry: Failed to append fetch header\n", .{});
            };
        }
    }
}

/// Notify telemetry of fetch operation end.
/// Call from fetch.zig onResolve() - single-line integration point.
pub fn notifyFetchEnd(
    globalObject: *JSGlobalObject,
    request_id: u64,
    start_time_ns: u64,
    metadata: ?http.HTTPResponseMetadata,
    body: ?*bun.MutableString,
) void {
    if (request_id == 0) return;
    if (telemetry.getGlobalTelemetry()) |telemetry_instance| {
        const status_code: u16 = if (metadata) |m| @truncate(m.response.status_code) else 200;
        const content_length: u64 = if (body) |b| b.list.items.len else 0;
        var end_attrs = buildFetchEndAttributes(globalObject, start_time_ns, status_code, content_length, null);
        telemetry_instance.notifyOperationEnd(.fetch, request_id, end_attrs.toJS());
    }
}

/// Notify telemetry of fetch operation error.
/// Call from fetch.zig onReject() - single-line integration point.
pub fn notifyFetchError(
    globalObject: *JSGlobalObject,
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
            globalObject,
            start_time_ns,
            error_type_str,
            error_message_str.slice(),
            null,
            if (metadata) |m| @as(u16, @truncate(m.response.status_code)) else null,
        );
        telemetry_instance.notifyOperationError(.fetch, request_id, error_attrs.toJS());
    }
}
