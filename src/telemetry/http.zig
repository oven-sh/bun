const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const telemetry = @import("main.zig");
const AttributeMap = telemetry.AttributeMap;
const AttributeKey = telemetry.AttributeKey;
const traceparent = @import("traceparent.zig");
const simple_url_parser = @import("simple_url_parser.zig");

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

    // Parse URL (handles both full URLs and path-only from HTTP server)
    const parsed = simple_url_parser.parseURL(url);
    if (parsed.path.len > 0) {
        attrs.fastSet(.url_path, ZigString.init(parsed.path).toJS(globalObject));
    }
    if (parsed.query.len > 0) {
        attrs.fastSet(.url_query, ZigString.init(parsed.query).toJS(globalObject));
    }
    if (parsed.scheme.len > 0) {
        attrs.set("url.scheme", ZigString.init(parsed.scheme).toJS(globalObject));
    }
    if (parsed.host.len > 0) {
        attrs.fastSet(.server_address, ZigString.init(parsed.host).toJS(globalObject));
    }
    if (parsed.port) |port| {
        attrs.fastSet(.server_port, JSValue.jsNumber(@as(f64, @floatFromInt(port))));
    }

    // Request headers capture and traceparent extraction
    if (headers) |headers_jsvalue| {
        // Capture configured request headers
        captureJSValueHeaders(&attrs, headers_jsvalue, globalObject, .http_capture_headers_server_request, true);

        // Extract traceparent header for distributed tracing
        extractTraceparent(&attrs, headers_jsvalue, globalObject);
    }

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

    // Response headers capture
    if (headers) |headers_jsvalue| {
        captureJSValueHeaders(&attrs, headers_jsvalue, globalObject, .http_capture_headers_server_response, false);
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

// ============================================================================
// Header Capture and Traceparent Extraction Helpers
// ============================================================================

/// Capture configured headers from JSValue (FetchHeaders object) and add to attributes map
/// @param is_request - true for request headers ("http.request.header.*"), false for response ("http.response.header.*")
fn captureJSValueHeaders(
    attrs: *AttributeMap,
    headers_jsvalue: JSValue,
    globalObject: *JSGlobalObject,
    comptime config_property: telemetry.ConfigurationProperty,
    comptime is_request: bool,
) void {
    // Set up exception handling FIRST, before any JavaScript operations
    var catch_scope: jsc.CatchScope = undefined;
    catch_scope.init(globalObject, @src());
    defer catch_scope.deinit();

    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Get configured header names from telemetry config
    const config_property_id = @intFromEnum(config_property);
    const header_names_js = telemetry_inst.getConfigurationProperty(config_property_id);
    if (header_names_js.isUndefined() or !header_names_js.isArray()) return;

    const header_names_len = header_names_js.getLength(globalObject) catch return;
    if (header_names_len == 0) return;

    // Headers can be either FetchHeaders (has .get() method) or a plain object
    if (headers_jsvalue.isUndefined() or headers_jsvalue.isNull()) return;

    // Try FetchHeaders fast path first (has .get() method)
    const get_method = headers_jsvalue.get(globalObject, "get") catch blk: {
        _ = catch_scope.clearException();
        break :blk null;
    };

    const use_fetch_headers = if (get_method) |method| method.isCallable() else false;

    // Iterate through configured header names
    var i: u32 = 0;
    while (i < header_names_len) : (i += 1) {
        const header_name_js = header_names_js.getIndex(globalObject, i) catch {
            _ = catch_scope.clearException();
            continue;
        };
        if (!header_name_js.isString()) continue;

        // Convert header name to ZigString (used by both paths)
        var header_name_zig: ZigString = ZigString.Empty;
        header_name_js.toZigString(&header_name_zig, globalObject) catch continue;

        // Get header value using appropriate method
        const header_value_js = if (use_fetch_headers) blk: {
            // Fast path: FetchHeaders with .get() method
            const args = [_]JSValue{header_name_js};
            break :blk get_method.?.callWithGlobalThis(globalObject, &args) catch {
                _ = catch_scope.clearException();
                continue;
            };
        } else blk: {
            // Slow path: Plain object property access
            const value = headers_jsvalue.get(globalObject, header_name_zig.slice()) catch {
                _ = catch_scope.clearException();
                continue;
            };
            break :blk value orelse continue;
        };

        if (header_value_js.isNull() or header_value_js.isUndefined()) continue;
        if (!header_value_js.isString()) continue;
        const header_name_slice = header_name_zig.toSlice(bun.default_allocator);
        defer header_name_slice.deinit();

        // Build attribute key
        var attr_key_buf: [256]u8 = undefined;
        const attr_key = if (is_request)
            std.fmt.bufPrint(&attr_key_buf, "http.request.header.{s}", .{header_name_slice.slice()}) catch continue
        else
            std.fmt.bufPrint(&attr_key_buf, "http.response.header.{s}", .{header_name_slice.slice()}) catch continue;

        // Add to attributes
        attrs.set(attr_key, header_value_js);
    }
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

    // Call headers.get("traceparent")
    const traceparent_key = ZigString.init("traceparent").toJS(globalObject);
    const args = [_]JSValue{traceparent_key};
    const traceparent_value_js = get_method.?.callWithGlobalThis(globalObject, &args) catch {
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
    attrs.set("trace.parent.trace_id", ZigString.init(&ctx.trace_id).toJS(globalObject));
    attrs.set("trace.parent.span_id", ZigString.init(&ctx.span_id).toJS(globalObject));
    attrs.set("trace.parent.trace_flags", JSValue.jsNumber(@as(f64, @floatFromInt(ctx.trace_flags))));
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
    headers: JSValue,
) void {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;
    if (!telemetry_inst.isEnabledFor(.http)) return;

    // Generate unique request ID and store timestamp
    ctx.request_id = telemetry_inst.generateRequestId();
    ctx.start_time_ns = @intCast(std.time.nanoTimestamp());

    // Build and send start attributes
    var start_attrs = buildHttpStartAttributes(globalObject, ctx.request_id, method, url, headers);
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
    // Set up exception handling FIRST, before any JavaScript operations
    var catch_scope: jsc.CatchScope = undefined;
    catch_scope.init(globalObject, @src());
    defer catch_scope.deinit();

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
        const header_name_js = header_names_js.getIndex(globalObject, i) catch {
            _ = catch_scope.clearException();
            continue;
        };
        if (!header_name_js.isString()) continue;

        // Convert header name to ZigString
        var header_name_zig: ZigString = ZigString.Empty;
        header_name_js.toZigString(&header_name_zig, globalObject) catch continue;

        // Look up this header in all injected value objects
        // Using linear concatenation: iterate through all injected objects
        var j: u32 = 0;
        while (j < injected_values_len) : (j += 1) {
            const injected_obj = injected_values.getIndex(globalObject, j) catch {
                _ = catch_scope.clearException();
                continue;
            };
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
    // Set up exception handling FIRST, before any JavaScript operations
    var catch_scope: jsc.CatchScope = undefined;
    catch_scope.init(globalObject, @src());
    defer catch_scope.deinit();

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
        const header_name_js = header_names_js.getIndex(globalObject, i) catch {
            _ = catch_scope.clearException();
            continue;
        };
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
            const injected_obj = injected_values.getIndex(globalObject, j) catch {
                _ = catch_scope.clearException();
                continue;
            };
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
