const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const telemetry = @import("telemetry.zig");
const AttributeMap = telemetry.AttributeMap;
const AttributeKey = telemetry.AttributeKey;
const http = @import("../http.zig");
const Method = http.Method;
const simple_url_parser = @import("simple_url_parser.zig");

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
    headers: *const http.Headers,
) AttributeMap {
    const otel = telemetry.getGlobalTelemetry() orelse {
        return AttributeMap.init(globalObject);
    };

    var attrs = AttributeMap.init(globalObject);

    // Operation metadata
    attrs.set(otel.semconv.operation_id, telemetry.jsRequestId(request_id));

    // Timestamp: nanoseconds since epoch
    const timestamp_ns = std.time.nanoTimestamp();
    attrs.set(otel.semconv.operation_timestamp, timestamp_ns);

    // HTTP method
    attrs.set(otel.semconv.http_request_method, method);

    // URL components
    attrs.set(otel.semconv.url_full, url);

    // Parse URL (handles both full URLs from fetch)
    const parsed = simple_url_parser.parseURL(url);
    if (parsed.path.len > 0) {
        attrs.set(otel.semconv.url_path, parsed.path);
    }
    if (parsed.query.len > 0) {
        attrs.set(otel.semconv.url_query, parsed.query);
    }
    if (parsed.scheme.len > 0) {
        attrs.set(otel.semconv.url_scheme, parsed.scheme);
    }
    if (parsed.host.len > 0) {
        attrs.set(otel.semconv.server_address, parsed.host);
    }
    if (parsed.port) |port| {
        attrs.set(otel.semconv.server_port, port);
    }

    // Outgoing request headers (capture configured headers)
    captureRequestHeaders(&attrs, headers, globalObject, .http_capture_headers_fetch_request);

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
    start_timestamp_ns: telemetry.OpTime,
    metadata: ?http.HTTPResponseMetadata,
    content_length: u64,
) AttributeMap {
    const otel = telemetry.getGlobalTelemetry() orelse {
        return AttributeMap.init(globalObject);
    };

    var attrs = AttributeMap.init(globalObject);

    // HTTP response status
    const status_code: u16 = if (metadata) |m| @truncate(m.response.status_code) else 200;
    attrs.set(otel.semconv.http_response_status_code, status_code);

    // Response body size
    attrs.set(otel.semconv.http_response_body_size, content_length);

    // Operation duration (uses centralized timing utility)
    const duration_ns = telemetry.calculateDuration(start_timestamp_ns);
    attrs.set(otel.semconv.operation_duration, duration_ns);

    // Response headers (capture configured headers from picohttp response)
    if (metadata) |m| {
        capturePicohttpResponseHeaders(&attrs, &m.response.headers, globalObject, .http_capture_headers_fetch_response);
    }

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
    start_timestamp_ns: telemetry.OpTime,
    error_type: []const u8,
    error_message: []const u8,
    stack_trace: ?[]const u8,
    status_code: ?u16,
) AttributeMap {
    const otel = telemetry.getGlobalTelemetry() orelse {
        return AttributeMap.init(globalObject);
    };

    var attrs = AttributeMap.init(globalObject);

    // Error information
    attrs.set(otel.semconv.error_type, error_type);
    attrs.set(otel.semconv.error_message, error_message);

    if (stack_trace) |stack| {
        attrs.set(otel.semconv.error_stack_trace, stack);
    }

    // Status code if response was received
    if (status_code) |code| {
        attrs.set(otel.semconv.http_response_status_code, code);
    }

    // Operation duration (uses centralized timing utility)
    const duration_ns = telemetry.calculateDuration(start_timestamp_ns);
    attrs.set(otel.semconv.operation_duration, duration_ns);

    return attrs;
}

// ============================================================================
// Header Capture Helpers
// ============================================================================

/// Capture configured request headers and add to attributes map
/// Uses pre-computed HeaderNameList for efficient header extraction with AttributeKey pointers
fn captureRequestHeaders(
    attrs: *AttributeMap,
    headers_obj: *const http.Headers,
    globalObject: *JSGlobalObject,
    comptime config_property: telemetry.ConfigurationProperty,
) void {
    _ = globalObject;
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Get pre-computed HeaderNameList from telemetry config
    const config_property_id = @intFromEnum(config_property);
    const header_list = telemetry_inst.config.getHeaderList(config_property_id) orelse return;

    // Iterate through pre-computed AttributeKey pointers
    for (header_list.items.items) |attr_key| {
        if (attr_key.http_header) |header_name| {
            // Get header value using naked header name
            if (headers_obj.get(header_name)) |header_value| {
                // Set using AttributeKey pointer directly (no string conversion!)
                attrs.set(attr_key, header_value);
            }
        }
    }
}

/// Capture configured response headers from http.Headers and add to attributes map
/// Uses pre-computed HeaderNameList for efficient header extraction with AttributeKey pointers
fn captureResponseHeaders(
    attrs: *AttributeMap,
    headers_obj: *const http.Headers,
    globalObject: *JSGlobalObject,
    comptime config_property: telemetry.ConfigurationProperty,
) void {
    _ = globalObject;
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Get pre-computed HeaderNameList from telemetry config
    const config_property_id = @intFromEnum(config_property);
    const header_list = telemetry_inst.config.getHeaderList(config_property_id) orelse return;

    // Iterate through pre-computed AttributeKey pointers
    for (header_list.items.items) |attr_key| {
        if (attr_key.http_header) |header_name| {
            // Get header value using naked header name
            if (headers_obj.get(header_name)) |header_value| {
                // Set using AttributeKey pointer directly (no string conversion!)
                attrs.set(attr_key, header_value);
            }
        }
    }
}

/// Capture configured response headers from picohttp response and add to attributes map
/// Uses pre-computed HeaderNameList for efficient header extraction with AttributeKey pointers
fn capturePicohttpResponseHeaders(
    attrs: *AttributeMap,
    pico_headers: *const bun.picohttp.Header.List,
    globalObject: *JSGlobalObject,
    comptime config_property: telemetry.ConfigurationProperty,
) void {
    _ = globalObject;
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Get pre-computed HeaderNameList from telemetry config
    const config_property_id = @intFromEnum(config_property);
    const header_list = telemetry_inst.config.getHeaderList(config_property_id) orelse return;

    // Iterate through pre-computed AttributeKey pointers
    for (header_list.items.items) |attr_key| {
        if (attr_key.http_header) |header_name| {
            // Get header value using naked header name (case-insensitive lookup)
            if (pico_headers.get(header_name)) |header_value| {
                // Set using AttributeKey pointer directly (no string conversion!)
                attrs.set(attr_key, header_value);
            }
        }
    }
}

// ============================================================================
// High-level helpers for minimal fetch.zig integration
// ============================================================================

/// Notify telemetry of fetch operation start. Returns request_id if telemetry enabled, null otherwise.
/// Call from fetch.zig queue() function - single-line integration point.
/// Also injects propagation headers into the request.
pub fn notifyFetchStart(
    globalObject: *JSGlobalObject,
    method: Method,
    url: []const u8,
    request_headers: *http.Headers, // Mutable headers for injection and capture
) ?u64 {
    if (telemetry.getGlobalTelemetry()) |telemetry_instance| {
        if (telemetry_instance.isEnabledFor(.fetch)) {
            const request_id = telemetry_instance.generateId();
            const method_str = @tagName(method);
            var start_attrs = buildFetchStartAttributes(globalObject, request_id, method_str, url, request_headers);
            telemetry_instance.notifyOperationStart(.fetch, request_id, &start_attrs);

            // Inject propagation headers (e.g., traceparent, tracestate)
            injectFetchHeaders(request_headers, request_id, globalObject);

            return request_id;
        }
    }
    return null;
}

/// Inject propagation headers into fetch request headers
/// Called internally by notifyFetchStart - no separate integration point needed
///
/// Contract: Two-stage pattern per telemetry-http.md
/// 1. Get configured header names from config (array of strings)
/// 2. Call hooks to get values (returns flat array of strings)
/// 3. Zip arrays by index: names[i] = values[i]
///
/// Linear concatenation: If multiple hooks return values, they are
/// concatenated in the flat array allowing duplicate headers.
fn injectFetchHeaders(
    headers: *http.Headers,
    request_id: u64,
    globalObject: *JSGlobalObject,
) void {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Get configured header names (array of strings)
    const config_property_id = @intFromEnum(telemetry.ConfigurationProperty.http_propagate_headers_fetch_request);
    const header_names_js = telemetry_inst.getConfigurationProperty(config_property_id);
    if (header_names_js.isUndefined() or !header_names_js.isArray()) return;

    // Create empty attributes for injection context
    var empty_attrs = telemetry_inst.createAttributeMap();

    // Call all instruments to get header values (returns flat array)
    const injected_values = telemetry_inst.notifyOperationInject(.fetch, request_id, &empty_attrs);
    if (injected_values.isUndefined() or !injected_values.isArray()) return;

    const header_names_len = header_names_js.getLength(globalObject) catch return;
    const injected_values_len = injected_values.getLength(globalObject) catch return;
    if (header_names_len == 0 or injected_values_len == 0) return;

    // Zip header names and values by index
    var i: u32 = 0;
    while (i < @min(header_names_len, injected_values_len)) : (i += 1) {
        const header_name_js = header_names_js.getIndex(globalObject, i) catch continue;
        if (!header_name_js.isString()) continue;

        const header_value_js = injected_values.getIndex(globalObject, i) catch continue;
        if (header_value_js.isUndefined() or header_value_js.isNull()) continue;
        if (!header_value_js.isString()) continue;

        // Convert to Zig strings
        var header_name_zig: ZigString = ZigString.Empty;
        header_name_js.toZigString(&header_name_zig, globalObject) catch continue;
        const header_name_slice = header_name_zig.toSlice(bun.default_allocator);
        defer header_name_slice.deinit();

        var header_value_zig: ZigString = ZigString.Empty;
        header_value_js.toZigString(&header_value_zig, globalObject) catch continue;
        const header_value_slice = header_value_zig.toSlice(bun.default_allocator);
        defer header_value_slice.deinit();

        // Append to headers
        headers.append(header_name_slice.slice(), header_value_slice.slice()) catch {};
    }
}

/// Notify telemetry of fetch operation end.
/// Call from fetch.zig onResolve() - single-line integration point.
pub fn notifyFetchEnd(
    globalObject: *JSGlobalObject,
    request_id: u64,
    start_time_ns: telemetry.OpTime,
    metadata: ?http.HTTPResponseMetadata,
    body: ?*bun.MutableString,
) void {
    if (request_id == 0) return;
    if (telemetry.getGlobalTelemetry()) |telemetry_instance| {
        const content_length: u64 = if (body) |b| b.list.items.len else 0;
        var end_attrs = buildFetchEndAttributes(globalObject, start_time_ns, metadata, content_length);
        telemetry_instance.notifyOperationEnd(.fetch, request_id, &end_attrs);
    }
}

/// Notify telemetry of fetch operation error.
/// Call from fetch.zig onReject() - single-line integration point.
pub fn notifyFetchError(
    globalObject: *JSGlobalObject,
    request_id: u64,
    start_time_ns: telemetry.OpTime,
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
        telemetry_instance.notifyOperationError(.fetch, request_id, &error_attrs);
    }
}
