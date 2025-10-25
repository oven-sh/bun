const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const Output = bun.Output;
const telemetry = @import("telemetry.zig");
const attributes = @import("attributes.zig");
const AttributeMap = attributes.AttributeMap;
const AttributeKey = attributes.AttributeKey;
const semconv = @import("semconv.zig");
const traceparent = @import("traceparent.zig");
const simple_url_parser = @import("simple_url_parser.zig");

/// Context for tracking HTTP request telemetry state
pub const HttpTelemetryContext = struct {
    request_id: u64 = 0,
    start_time_ns: telemetry.OpTime = 0,

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
    fetch_headers: *bun.webcore.FetchHeaders,
    host_header: ?[]const u8,
    fallback_server_address: ?[]const u8,
    fallback_server_port: ?u16,
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

    // Parse URL (handles both full URLs and path-only from HTTP server)
    const parsed = simple_url_parser.parseURL(url);
    if (parsed.path.len > 0) {
        attrs.set(otel.semconv.url_path, parsed.path);
    }
    if (parsed.query.len > 0) {
        attrs.set(otel.semconv.url_query, parsed.query);
    }
    // URL scheme - default to "http" for path-only URLs (could be https, but doing the simple thing for now)
    if (parsed.scheme.len > 0) {
        attrs.set(otel.semconv.url_scheme, parsed.scheme);
    } else {
        attrs.set(otel.semconv.url_scheme, "http");
    }

    // Server address and port: prioritize Host header, then fallback
    // Per OpenTelemetry semantic conventions, Host header takes precedence
    const host_parts = if (host_header) |h| simple_url_parser.parseHostHeader(h) else simple_url_parser.URLParts{};

    if (host_parts.host.len > 0) {
        attrs.set(otel.semconv.server_address, host_parts.host);
    } else if (fallback_server_address) |addr| {
        attrs.set(otel.semconv.server_address, addr);
    }

    if (host_parts.port) |port| {
        attrs.set(otel.semconv.server_port, port);
    } else if (fallback_server_port) |port| {
        attrs.set(otel.semconv.server_port, port);
    }

    // Request headers capture and traceparent extraction (using native FetchHeaders)
    captureNativeFetchHeaders(&attrs, fetch_headers, globalObject, .http_capture_headers_server_request);
    extractTraceparentFromFetchHeaders(&attrs, fetch_headers, globalObject);

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
    start_timestamp_ns: telemetry.OpTime,
    status_code: u16,
    content_length: u64,
    headers: ?JSValue,
) AttributeMap {
    const otel = telemetry.getGlobalTelemetry() orelse {
        return AttributeMap.init(globalObject);
    };

    var attrs = AttributeMap.init(globalObject);

    // HTTP response status
    attrs.set(otel.semconv.http_response_status_code, status_code);

    // Response body size
    attrs.set(otel.semconv.http_response_body_size, content_length);

    // Operation duration (uses centralized timing utility)
    const duration_ns = telemetry.calculateDuration(start_timestamp_ns);
    attrs.set(otel.semconv.operation_duration, duration_ns);

    // Response headers capture
    if (headers) |headers_jsvalue| {
        captureJSValueHeaders(&attrs, headers_jsvalue, globalObject, .http_capture_headers_server_response);
    }

    return attrs;
}

/// Build HTTP response end attributes using native FetchHeaders (optimized path)
/// Same as buildHttpEndAttributes but uses FetchHeaders pointer for O(1) header access
fn buildHttpEndAttributesNative(
    globalObject: *JSGlobalObject,
    start_timestamp_ns: telemetry.OpTime,
    status_code: u16,
    content_length: u64,
    fetch_headers: ?*bun.webcore.FetchHeaders,
) AttributeMap {
    const otel = telemetry.getGlobalTelemetry() orelse {
        return AttributeMap.init(globalObject);
    };

    var attrs = AttributeMap.init(globalObject);

    // HTTP response status
    attrs.set(otel.semconv.http_response_status_code, status_code);

    // Response body size
    attrs.set(otel.semconv.http_response_body_size, content_length);

    // Operation duration (uses centralized timing utility)
    const duration_ns = telemetry.calculateDuration(start_timestamp_ns);
    attrs.set(otel.semconv.operation_duration, duration_ns);

    // Response headers capture (native FetchHeaders - optimized)
    if (fetch_headers) |headers| {
        captureNativeFetchHeaders(&attrs, headers, globalObject, .http_capture_headers_server_response);
    }

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

    // Status code if response was sent
    if (status_code) |code| {
        attrs.set(otel.semconv.http_response_status_code, code);
    }

    // Operation duration (uses centralized timing utility)
    const duration_ns = telemetry.calculateDuration(start_timestamp_ns);
    attrs.set(otel.semconv.operation_duration, duration_ns);

    return attrs;
}

// ============================================================================
// Header Capture and Traceparent Extraction Helpers
// ============================================================================

/// Capture configured headers from native FetchHeaders and add to attributes map
/// Uses pre-computed HeaderNameList for efficient header extraction
fn captureNativeFetchHeaders(
    attrs: *AttributeMap,
    fetch_headers: *bun.webcore.FetchHeaders,
    globalObject: *JSGlobalObject,
    comptime config_property: telemetry.ConfigurationProperty,
) void {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Get pre-computed HeaderNameList from telemetry config
    const config_property_id = @intFromEnum(config_property);
    const header_list = telemetry_inst.config.getHeaderList(config_property_id) orelse return;

    // Use native FetchHeaders methods (no JS overhead)
    attrs.extractHeadersFromNativeFetchHeaders(fetch_headers, header_list, globalObject);
}

/// Capture configured headers from JSValue (FetchHeaders object or plain object) and add to attributes map
/// Uses pre-computed HeaderNameList for efficient header extraction
fn captureJSValueHeaders(
    attrs: *AttributeMap,
    headers_jsvalue: JSValue,
    globalObject: *JSGlobalObject,
    comptime config_property: telemetry.ConfigurationProperty,
) void {
    // Set up exception handling FIRST, before any JavaScript operations
    var catch_scope: jsc.CatchScope = undefined;
    catch_scope.init(globalObject, @src());
    defer catch_scope.deinit();

    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Get pre-computed HeaderNameList from telemetry config
    const config_property_id = @intFromEnum(config_property);
    const header_list = telemetry_inst.config.getHeaderList(config_property_id) orelse return;

    // Headers can be either FetchHeaders (has .get() method) or a plain object
    if (headers_jsvalue.isUndefined() or headers_jsvalue.isNull()) return;

    // Try FetchHeaders fast path first (has .get() method)
    const get_method = headers_jsvalue.get(globalObject, "get") catch blk: {
        _ = catch_scope.clearException();
        break :blk null;
    };

    const use_fetch_headers = if (get_method) |method| method.isCallable() else false;

    if (use_fetch_headers) {
        // Fast path: FetchHeaders with direct ID lookup
        attrs.extractHeadersFromFetchHeaders(headers_jsvalue, header_list, globalObject);
    } else {
        // Slow path: Plain object property access
        attrs.extractHeadersFromPlainObject(headers_jsvalue, header_list, globalObject);
    }
}

/// Extract traceparent header from native FetchHeaders and parse W3C Trace Context
/// Sets attributes: trace.parent.trace_id, trace.parent.span_id, trace.parent.trace_flags
///
/// Uses the W3C spec-compliant parser from ../telemetry/traceparent.zig
fn extractTraceparentFromFetchHeaders(
    attrs: *AttributeMap,
    fetch_headers: *bun.webcore.FetchHeaders,
    globalObject: *JSGlobalObject,
) void {
    const otel = telemetry.getGlobalTelemetry() orelse return;

    // Get "traceparent" header value directly from FetchHeaders (no JS needed)
    const traceparent_value = fetch_headers.get("traceparent", globalObject) orelse return;
    if (traceparent_value.len == 0) return;

    // Parse using W3C spec-compliant parser
    const ctx = traceparent.TraceContext.parse(traceparent_value) orelse return;

    // Set attributes for distributed tracing
    attrs.set(otel.semconv.trace_parent_trace_id, &ctx.trace_id);
    attrs.set(otel.semconv.trace_parent_span_id, &ctx.span_id);
    attrs.set(otel.semconv.trace_parent_trace_flags, ctx.trace_flags);
}

/// Extract traceparent header and parse W3C Trace Context into attributes
/// Sets attributes: trace.parent.trace_id, trace.parent.span_id, trace.parent.trace_flags
///
/// Uses the W3C spec-compliant parser from ../telemetry/traceparent.zig
fn extractTraceparent(
    attrs: *AttributeMap,
    headers_jsvalue: JSValue,
    globalObject: *JSGlobalObject,
) void {
    const otel = telemetry.getGlobalTelemetry() orelse return;

    // Set up exception handling for JavaScript operations
    var catch_scope: jsc.CatchScope = undefined;
    catch_scope.init(globalObject, @src());
    defer catch_scope.deinit();

    // Check if headers is valid
    if (headers_jsvalue.isUndefined() or headers_jsvalue.isNull()) return;

    // Get the headers.get method
    const get_method = headers_jsvalue.get(globalObject, "get") catch {
        _ = catch_scope.clearException();
        return;
    };
    if (get_method == null or !get_method.?.isCallable()) return;

    // Call headers.get("traceparent") with headers as `this` context
    const traceparent_key = ZigString.init("traceparent").toJS(globalObject);
    const args = [_]JSValue{traceparent_key};
    const traceparent_value_js = get_method.?.call(globalObject, headers_jsvalue, &args) catch {
        _ = catch_scope.clearException();
        return;
    };

    if (traceparent_value_js.isNull() or traceparent_value_js.isUndefined()) return;
    if (!traceparent_value_js.isString()) return;

    // Convert to Zig string
    var traceparent_zig: ZigString = ZigString.Empty;
    traceparent_value_js.toZigString(&traceparent_zig, globalObject) catch return;
    const traceparent_slice = traceparent_zig.toSlice(bun.default_allocator);
    defer traceparent_slice.deinit();

    // Parse using W3C spec-compliant parser
    const ctx = traceparent.TraceContext.parse(traceparent_slice.slice()) orelse return;

    // Set attributes for distributed tracing
    attrs.set(otel.semconv.trace_parent_trace_id, &ctx.trace_id);
    attrs.set(otel.semconv.trace_parent_span_id, &ctx.span_id);
    attrs.set(otel.semconv.trace_parent_trace_flags, ctx.trace_flags);
}

// ============================================================================
// FetchHeaders Access Helpers
// ============================================================================

/// Get FetchHeaders from Request object for telemetry purposes
///
/// This extracts the native FetchHeaders pointer from the Request object
/// avoiding expensive JS property access. Uses ensureFetchHeaders() which
/// creates from uws.Request if headers haven't been accessed yet.
///
/// Args:
///   request: The native WebCore.Request object containing headers
///   globalObject: JSGlobalObject for header creation if needed
///
/// Returns:
///   Pointer to FetchHeaders (either cached or newly created from uws.Request)
///   Never null - always returns a valid FetchHeaders pointer.
inline fn getFetchHeadersForTelemetry(
    request: *bun.webcore.Request,
    globalObject: *JSGlobalObject,
) *bun.webcore.FetchHeaders {
    // ensureFetchHeaders() creates from uws.Request if not cached
    // For server requests with uws.Request, this won't throw errors
    return request.ensureFetchHeaders(globalObject) catch unreachable;
}

// ============================================================================
// High-Level Notification Helpers (minimize changes to core Bun code)
// ============================================================================

/// Notify HTTP request start - call this AFTER URL is available, BEFORE user handler
/// Returns initialized context for tracking this request
pub inline fn notifyHttpRequestStart(
    ctx: *HttpTelemetryContext,
    globalObject: *JSGlobalObject,
    request: *bun.webcore.Request,
    uws_req: anytype, // *uws.Request
    method: []const u8,
    server: anytype, // *Server (generic to handle HTTP/HTTPS/Debug variants)
) void {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;
    if (!telemetry_inst.isEnabledFor(.http)) return;

    // Generate unique request ID and store timestamp
    ctx.request_id = telemetry_inst.generateId();
    ctx.start_time_ns = telemetry.getOperationStartTime();

    // Get FetchHeaders directly from Request (no JS property access)
    const fetch_headers = getFetchHeadersForTelemetry(request, globalObject);

    // Extract Host header for server.address/port (OpenTelemetry semantic conventions)
    const host_header = uws_req.header("host");

    // Get fallback server address and port from server configuration
    const fallback_address: ?[]const u8 = switch (server.config.address) {
        .tcp => |tcp| if (tcp.hostname) |h| bun.sliceTo(@constCast(h), 0) else null,
        else => null,
    };
    const fallback_port: ?u16 = if (server.listener) |l|
        @intCast(l.getLocalPort())
    else switch (server.config.address) {
        .tcp => |tcp| tcp.port,
        else => @as(u16, if (@hasField(@TypeOf(server.*), "ssl_enabled") and server.ssl_enabled) 443 else 80),
    };

    // Build and send start attributes
    var start_attrs = buildHttpStartAttributes(
        globalObject,
        ctx.request_id,
        method,
        uws_req.url(),
        fetch_headers,
        host_header,
        fallback_address,
        fallback_port,
    );
    telemetry_inst.notifyOperationStart(.http, ctx.request_id, &start_attrs);
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
    telemetry_inst.notifyOperationError(.http, ctx.request_id, &error_attrs);
}

/// Notify response headers available - call this in renderMetadata when headers are being written
/// Sends an operation progress event with response headers (before they're freed)
pub inline fn notifyHttpResponseHeaders(
    ctx: *const HttpTelemetryContext,
    globalObject: *JSGlobalObject,
    fetch_headers: *bun.webcore.FetchHeaders,
) void {
    if (!ctx.isEnabled()) return;
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Build attributes with only response headers
    var progress_attrs = AttributeMap.init(globalObject);
    captureNativeFetchHeaders(&progress_attrs, fetch_headers, globalObject, .http_capture_headers_server_response);

    // Send progress event (preserves request state, adds these attributes)
    telemetry_inst.notifyOperationProgress(.http, ctx.request_id, &progress_attrs);
}

/// Notify HTTP request end - call this in finalizeWithoutDeinit
/// Automatically resets the context to prevent double-cleanup
/// Note: Response headers are captured earlier in notifyHttpResponseHeaders()
pub inline fn notifyHttpRequestEnd(
    ctx: *HttpTelemetryContext,
    globalObject: *JSGlobalObject,
    status_code: u16,
    content_length: u64,
) void {
    if (!ctx.isEnabled()) return;
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Build end attributes (status code, body size, duration)
    // Headers were already captured in notifyHttpResponseHeaders() via notifyOperationUpdate
    var end_attrs = buildHttpEndAttributesNative(globalObject, ctx.start_time_ns, status_code, content_length, null);
    telemetry_inst.notifyOperationEnd(.http, ctx.request_id, &end_attrs);

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
///   addPropagationHeaders(.http, req_id, response.headers, global);
///
/// Contract: Two-stage pattern per telemetry-http.md
/// 1. Get configured header names from config (array of strings)
/// 2. Call hooks to get values (returns flat array of strings)
/// 3. Zip arrays by index: names[i] = values[i]
///
/// Linear concatenation: If multiple hooks return values, they are
/// concatenated in the flat array allowing duplicate headers.
pub inline fn addPropagationHeaders(
    comptime kind: telemetry.InstrumentKind,
    request_id: u64,
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

    // Get configured header names (array of strings)
    const header_names_js = telemetry_inst.getConfigurationProperty(config_property_id);
    if (header_names_js.isUndefined() or !header_names_js.isArray()) return;

    // Create empty attributes for injection context
    var empty_attrs = telemetry_inst.createAttributeMap();

    // Call all instruments to get header values (returns flat array)
    const injected_values = telemetry_inst.notifyOperationInject(kind, request_id, &empty_attrs);
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

        // Convert to ZigStrings
        var header_name_zig: ZigString = ZigString.Empty;
        header_name_js.toZigString(&header_name_zig, globalObject) catch continue;

        var header_value_zig: ZigString = ZigString.Empty;
        header_value_js.toZigString(&header_value_zig, globalObject) catch continue;

        // Append to FetchHeaders
        headers.append(&header_name_zig, &header_value_zig, globalObject);
    }
}

/// Render injected trace headers to uWebSockets Response using stack-allocated buffers
/// MUST be called at the end of renderMetadata, after all other headers
///
/// Contract: Two-stage pattern per telemetry-http.md
/// 1. Get configured header names from config (array of strings)
/// 2. Call hooks to get values (returns flat array of strings)
/// 3. Zip arrays by index: names[i] = values[i]
///
/// Linear concatenation: If multiple hooks return values, they are
/// concatenated in the flat array allowing duplicate headers.
pub inline fn renderInjectedTraceHeadersToUWSResponse(
    comptime kind: telemetry.InstrumentKind,
    request_id: u64,
    resp: anytype, // uws Response
    globalObject: *JSGlobalObject,
) void {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;
    if (!telemetry_inst.isEnabledFor(kind)) return;

    const config_property_id: u8 = switch (kind) {
        .http => @intFromEnum(telemetry.ConfigurationProperty.http_propagate_headers_server_response),
        else => return,
    };

    // Get configured header names (array of strings)
    const header_names_js = telemetry_inst.getConfigurationProperty(config_property_id);
    if (header_names_js.isUndefined() or !header_names_js.isArray()) return;

    // Create empty attributes for injection context
    var empty_attrs = telemetry_inst.createAttributeMap();

    // Call all instruments to get header values (returns flat array)
    const injected_values = telemetry_inst.notifyOperationInject(kind, request_id, &empty_attrs);
    if (injected_values.isUndefined() or !injected_values.isArray()) return;

    const header_names_len = header_names_js.getLength(globalObject) catch return;
    const injected_values_len = injected_values.getLength(globalObject) catch return;
    if (header_names_len == 0 or injected_values_len == 0) return;

    // Stack-allocated buffers for header name and value
    var header_name_buf: [256]u8 = undefined;
    var header_value_buf: [1024]u8 = undefined;

    // Zip header names and values by index
    var i: u32 = 0;
    while (i < @min(header_names_len, injected_values_len)) : (i += 1) {
        const header_name_js = header_names_js.getIndex(globalObject, i) catch continue;
        if (!header_name_js.isString()) continue;

        const header_value_js = injected_values.getIndex(globalObject, i) catch continue;
        if (header_value_js.isUndefined() or header_value_js.isNull()) continue;
        if (!header_value_js.isString()) continue;

        // Copy header name to stack buffer
        var header_name_zig: ZigString = ZigString.Empty;
        header_name_js.toZigString(&header_name_zig, globalObject) catch continue;
        const header_name_len = @min(header_name_zig.len, header_name_buf.len);
        if (header_name_len == 0) continue;
        @memcpy(header_name_buf[0..header_name_len], header_name_zig.slice()[0..header_name_len]);
        const header_name_slice = header_name_buf[0..header_name_len];

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
