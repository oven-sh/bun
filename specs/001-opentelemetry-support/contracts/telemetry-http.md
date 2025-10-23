# Contract: HTTP Instrumentation

**Feature**: OpenTelemetry Support for Bun
**Component**: HTTP Instrumentation (server.zig, fetch.zig)
**Scope**: HTTP-specific telemetry instrumentation for servers and clients
**Audience**: Bun core contributors implementing HTTP telemetry

**Related**: See `telemetry-context.md` for the base TelemetryContext API

# Purpose

Define HTTP-specific instrumentation contracts, including:
- Header injection format for distributed tracing
- HTTP semantic conventions usage (OpenTelemetry v1.23.0+)
- Server and client instrumentation patterns
- Configuration properties for HTTP propagation
- Trace context extraction and injection

# Configuration: captureAttributes vs injectHeaders

Two distinct configuration mechanisms control header behavior:

## captureAttributes (READ headers)

Controls which headers are **READ** from incoming requests/responses and included as span attributes.

**Location**: `NativeInstrument.captureAttributes`

**Purpose**: Capture specific headers as span attributes for observability

**Direction**:
- `requestHeaders`: Read from incoming HTTP server requests OR outgoing fetch client requests
- `responseHeaders`: Read from outgoing HTTP server responses OR incoming fetch client responses

**Example**:
```typescript
Bun.telemetry.attach({
  type: "http",
  captureAttributes: {
    requestHeaders: ["content-type", "user-agent"], // Capture these incoming headers
    responseHeaders: ["content-type"],              // Capture these outgoing headers
  },
  onOperationStart(id, attributes) {
    // attributes["http.request.header.content-type"] available
    // attributes["http.request.header.user-agent"] available
  },
});
```

## injectHeaders (WRITE headers)

Controls which headers are **WRITTEN** to outgoing requests/responses for distributed tracing.

**Location**: `NativeInstrument.injectHeaders`

**Purpose**: Propagate trace context to downstream services

**Direction**:
- `request`: Write to outgoing fetch client requests
- `response`: Write to outgoing HTTP server responses

**Example**:
```typescript
Bun.telemetry.attach({
  type: "http",
  injectHeaders: {
    request: ["traceparent", "tracestate"],  // Inject into outgoing fetch requests
    response: ["traceparent"],                // Inject into HTTP server responses
  },
  onOperationInject(id, data) {
    // Return array of values matching injectHeaders order: ["traceparent", "tracestate"]
    return [
      `00-${traceId}-${spanId}-01`,  // traceparent
      `vendor=${vendorData}`,         // tracestate
    ];
  },
});
```

## Independence

These configurations are **completely independent**:
- `captureAttributes` does NOT control injection
- `injectHeaders` does NOT control capture
- You can capture headers without injecting
- You can inject headers without capturing

## Security

Both configurations respect the same security blocklist:
- Sensitive headers (authorization, cookie, api-key, etc.) CANNOT be captured or injected
- Validation occurs at `attach()` time
- Zig layer enforces (TypeScript cannot override)

# Header Injection Format

## Two-Stage Injection Pattern

Bun uses a two-stage pattern to minimize memory allocation during hot-path operations:

**Stage 1: Configuration** (at `attach()` time)
- Instrument declares header names via `injectHeaders` configuration
- Names stored once in configuration cache
- No per-request allocation

**Stage 2: Value Generation** (per operation)
- Zig calls `onOperationInject` hook
- Hook returns array of header values (not names!)
- Values correspond by index to names from configuration

## Fetch Client (Outgoing Requests)

When instrumenting HTTP client requests (fetch), the header injection pattern works as follows:

### 1. Configuration Declaration

Declare which headers to inject when attaching the instrument:

```typescript
Bun.telemetry.attach({
  type: "fetch",
  name: "@opentelemetry/instrumentation-fetch",
  version: "1.0.0",

  // Declare header names to inject
  injectHeaders: {
    request: ["traceparent", "tracestate"],
  },

  onOperationInject(id, data) {
    const span = trace.getActiveSpan();
    // Return array matching injectHeaders.request order: ["traceparent", "tracestate"]
    return [
      `00-${span.traceId}-${span.spanId}-01`,  // traceparent
      `vendor=${span.vendor}`,                  // tracestate
    ];
  },
});
```

### 2. Zig-Side Injection (fetch.zig)

In `notifyFetchStart()` (src/telemetry/fetch.zig:289-309):

```zig
pub fn notifyFetchStart(
    globalObject: *JSGlobalObject,
    method: Method,
    url: []const u8,
    request_headers: *http.Headers, // Mutable headers for injection
) ?u64 {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return null;
    if (!telemetry_inst.isEnabledFor(.fetch)) return null;

    const op_id = telemetry_inst.generateId();

    // Build and send start attributes
    var start_attrs = buildFetchStartAttributes(globalObject, op_id, method_str, url, request_headers);
    telemetry_inst.notifyOperationStart(.fetch, op_id, start_attrs.toJS());

    // Inject propagation headers
    injectFetchHeaders(request_headers, op_id, globalObject);

    return op_id;
}
```

Internal injection (src/telemetry/fetch.zig:313-370):

```zig
fn injectFetchHeaders(
    headers: *http.Headers,
    op_id: OpId,
    globalObject: *JSGlobalObject,
) void {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;

    // Get configured header names (from injectHeaders.request)
    const config_property_id = @intFromEnum(telemetry.ConfigurationProperty.http_propagate_headers_fetch_request);
    const header_names_js = telemetry_inst.getConfigurationProperty(config_property_id);
    if (header_names_js.isUndefined() or !header_names_js.isArray()) return;

    // Call all instruments to get header values
    const injected_values = telemetry_inst.notifyOperationInject(.fetch, op_id, .js_undefined);
    if (injected_values.isUndefined() or !injected_values.isArray()) return;

    // Iterate through configured header names
    var i: u32 = 0;
    while (i < header_names_len) : (i += 1) {
        const header_name_js = header_names_js.getIndex(globalObject, i) catch continue;
        if (!header_name_js.isString()) continue;

        // Look up this header in all injected value objects (linear concatenation)
        var j: u32 = 0;
        while (j < injected_values_len) : (j += 1) {
            const injected_obj = injected_values.getIndex(globalObject, j) catch continue;
            if (!injected_obj.isObject()) continue;

            const header_value_js = injected_obj.get(globalObject, header_name_slice.slice()) catch continue;
            if (header_value_js == null or !header_value_js.?.isString()) continue;

            // Append to headers (allows duplicates - linear concatenation)
            headers.append(header_name_slice.slice(), header_value_slice.slice()) catch {};
        }
    }
}
```

### 3. Memory Management

- Header names: Allocated once at attach time (cached in configuration)
- Header values: Stack-allocated per request (no heap allocation)
- Multiple instruments: Values concatenated linearly (allows duplicates)

## HTTP Server (Incoming Requests)

HTTP server instrumentation involves two operations:

### 1. Trace Context Extraction (Incoming Request)

Extract distributed tracing context from incoming request headers.

**W3C Traceparent Format**:
```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             ^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^  ^^
             |   |                                 |                 |
             |   trace-id (128-bit, 32 hex chars) span-id (64-bit) trace-flags
             version (must be 00)                  (16 hex chars)    (8-bit)
```

**Implementation** (src/telemetry/http.zig:224-272):

```zig
fn extractTraceparent(
    attrs: *AttributeMap,
    headers_jsvalue: JSValue,
    globalObject: *JSGlobalObject,
) void {
    // Get traceparent header value
    const get_method = headers_jsvalue.get(globalObject, "get") catch return;
    if (get_method == null or !get_method.?.isCallable()) return;

    const traceparent_key = ZigString.init("traceparent").toJS(globalObject);
    const traceparent_value_js = get_method.?.callWithGlobalThis(globalObject, &[_]JSValue{traceparent_key}) catch return;
    if (traceparent_value_js.isNull() or traceparent_value_js.isUndefined()) return;

    // Parse using W3C spec-compliant parser (src/telemetry/traceparent.zig)
    const ctx = traceparent.TraceContext.parse(traceparent_slice.slice()) orelse return;

    // Set distributed tracing attributes
    attrs.set("trace.parent.trace_id", ZigString.init(&ctx.trace_id).toJS(globalObject));
    attrs.set("trace.parent.span_id", ZigString.init(&ctx.span_id).toJS(globalObject));
    attrs.set("trace.parent.trace_flags", JSValue.jsNumber(@as(f64, @floatFromInt(ctx.trace_flags))));
}
```

**Attributes Set**:
- `trace.parent.trace_id`: string - 128-bit hex trace ID (32 chars)
- `trace.parent.span_id`: string - 64-bit hex parent span ID (16 chars)
- `trace.parent.trace_flags`: number - 0x01 = sampled, 0x00 = not sampled

**Validation** (W3C Trace Context spec compliant):
- Version must be `00` (or future versions >= `00`)
- Trace ID must be 32 hex characters, NOT all zeros
- Span ID must be 16 hex characters, NOT all zeros
- Trace flags must be 2 hex characters
- Total length must be exactly 55 bytes for version `00`
- Invalid headers are silently ignored (no error thrown)

### 2. Header Injection (Outgoing Response)

Inject trace context headers into HTTP server responses.

**Configuration**:
```typescript
Bun.telemetry.attach({
  type: "http",
  injectHeaders: {
    response: ["traceparent"], // Inject into HTTP server responses
  },
  onOperationInject(id, data) {
    const span = trace.getSpan(context.active());
    // Return array matching injectHeaders.response order: ["traceparent"]
    return [
      `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`,  // traceparent
    ];
  },
});
```

**Implementation** (src/telemetry/http.zig:459-540):

```zig
pub inline fn renderInjectedTraceHeadersToUWSResponse(
    comptime kind: telemetry.InstrumentKind,
    op_id: OpId,
    data: JSValue,
    resp: anytype, // uws Response
    globalObject: *JSGlobalObject,
) void {
    const telemetry_inst = telemetry.getGlobalTelemetry() orelse return;
    if (!telemetry_inst.isEnabledFor(kind)) return;

    // Get configured header names (from injectHeaders.response)
    const config_property_id: u8 = @intFromEnum(telemetry.ConfigurationProperty.http_propagate_headers_server_response);
    const header_names_js = telemetry_inst.getConfigurationProperty(config_property_id);
    if (header_names_js.isUndefined() or !header_names_js.isArray()) return;

    // Call all instruments to get header values
    const injected_values = telemetry_inst.notifyOperationInject(kind, op_id, data);
    if (injected_values.isUndefined() or !injected_values.isArray()) return;

    // Stack-allocated buffers for header name and value
    var header_name_buf: [256]u8 = undefined;
    var header_value_buf: [1024]u8 = undefined;

    // Iterate through configured header names
    var i: u32 = 0;
    while (i < header_names_len) : (i += 1) {
        // Iterate through all injected value objects (linear concatenation)
        var j: u32 = 0;
        while (j < injected_values_len) : (j += 1) {
            const injected_obj = injected_values.getIndex(globalObject, j) catch continue;
            const header_value_js = injected_obj.get(globalObject, header_name_zig.slice()) catch continue;

            // Copy to stack buffers and write to uws Response
            @memcpy(header_name_buf[0..header_name_len], header_name_zig.slice()[0..header_name_len]);
            @memcpy(header_value_buf[0..header_value_len], header_value_zig.slice()[0..header_value_len]);
            resp.writeHeader(header_name_slice, header_value_slice);
        }
    }
}
```

**Memory Management**:
- Stack-allocated buffers (256 bytes for name, 1024 bytes for value)
- No heap allocation in hot path
- Direct write to uWebSockets Response

# Configuration Properties

Configuration properties control which headers are captured and injected.

## Overview

All configuration properties are accessed via `TelemetryContext.getConfigurationProperty()`:

```zig
const header_list = otel.getConfigurationProperty(.http_propagate_headers_fetch_request);
```

Properties are computed from:
1. Environment variables (e.g., `BUN_OTEL_HTTP_PROPAGATE_HEADERS_FETCH_REQUEST`)
2. Instrument configuration (`injectHeaders` or `captureAttributes`)
3. Intersection: Only headers in BOTH ENV and instrument config are used

## HTTP Configuration Properties

### `.http_capture_headers_fetch_request`

**Purpose**: Headers to READ from outgoing fetch requests

**Type**: `AttributeList` (Zig), `string[]` (TypeScript)

**ENV Variable**: `BUN_OTEL_HTTP_CAPTURE_HEADERS_FETCH_REQUEST`

**Instrument Config**: `captureAttributes.requestHeaders` (for `type: "fetch"`)

**Default**: `["content-type", "content-length", "user-agent", "accept"]`

**Example**:
```bash
export BUN_OTEL_HTTP_CAPTURE_HEADERS_FETCH_REQUEST="content-type,user-agent,x-request-id"
```

```typescript
Bun.telemetry.attach({
  type: "fetch",
  captureAttributes: {
    requestHeaders: ["content-type", "x-request-id"], // Intersection with ENV
  },
});
// Result: ["content-type", "x-request-id"] (intersection)
```

### `.http_capture_headers_fetch_response`

**Purpose**: Headers to READ from incoming fetch responses

**Type**: `AttributeList` (Zig), `string[]` (TypeScript)

**ENV Variable**: `BUN_OTEL_HTTP_CAPTURE_HEADERS_FETCH_RESPONSE`

**Instrument Config**: `captureAttributes.responseHeaders` (for `type: "fetch"`)

**Default**: `["content-type", "content-length"]`

### `.http_capture_headers_server_request`

**Purpose**: Headers to READ from incoming HTTP server requests

**Type**: `AttributeList` (Zig), `string[]` (TypeScript)

**ENV Variable**: `BUN_OTEL_HTTP_CAPTURE_HEADERS_SERVER_REQUEST`

**Instrument Config**: `captureAttributes.requestHeaders` (for `type: "http"`)

**Default**: `["content-type", "content-length", "user-agent", "accept"]`

### `.http_capture_headers_server_response`

**Purpose**: Headers to READ from outgoing HTTP server responses

**Type**: `AttributeList` (Zig), `string[]` (TypeScript)

**ENV Variable**: `BUN_OTEL_HTTP_CAPTURE_HEADERS_SERVER_RESPONSE`

**Instrument Config**: `captureAttributes.responseHeaders` (for `type: "http"`)

**Default**: `["content-type", "content-length"]`

### `.http_propagate_headers_fetch_request`

**Purpose**: Headers to WRITE to outgoing fetch requests (distributed tracing)

**Type**: `AttributeList` (Zig), `string[]` (TypeScript)

**ENV Variable**: `BUN_OTEL_HTTP_PROPAGATE_HEADERS_FETCH_REQUEST`

**Instrument Config**: `injectHeaders.request` (for `type: "fetch"`)

**Default**: `["traceparent", "tracestate"]`

**Example**:
```typescript
Bun.telemetry.attach({
  type: "fetch",
  injectHeaders: {
    request: ["traceparent", "tracestate", "x-trace-id"],
  },
  onOperationInject(id, data) {
    // Return array matching injectHeaders.request order: ["traceparent", "tracestate", "x-trace-id"]
    return [
      `00-${traceId}-${spanId}-01`,  // traceparent
      `vendor=${vendor}`,             // tracestate
      traceId,                        // x-trace-id
    ];
  },
});
```

### `.http_propagate_headers_server_response`

**Purpose**: Headers to WRITE to outgoing HTTP server responses (distributed tracing)

**Type**: `AttributeList` (Zig), `string[]` (TypeScript)

**ENV Variable**: `BUN_OTEL_HTTP_PROPAGATE_HEADERS_SERVER_RESPONSE`

**Instrument Config**: `injectHeaders.response` (for `type: "http"`)

**Default**: `[]` (empty - no response header injection by default)

**Example**:
```typescript
Bun.telemetry.attach({
  type: "http",
  injectHeaders: {
    response: ["traceparent"], // Inject traceparent into server responses
  },
  onOperationInject(id, data) {
    const span = trace.getActiveSpan();
    // Return array matching injectHeaders.response order: ["traceparent"]
    return [
      `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`,  // traceparent
    ];
  },
});
```

## Security Constraints

**Blocked Headers** (always rejected, even if in ENV or config):
- `authorization`
- `proxy-authorization`
- `cookie`
- `set-cookie`
- `api-key`
- `x-api-key`
- `api-token`
- `x-auth-token`
- `x-csrf-token`
- `session-id`
- `session-token`

**Validation**:
- Case-insensitive blocking
- Partial matches blocked (e.g., `x-api-key-v2` blocked)
- Enforced at `attach()` time
- Throws `TypeError` if blocked header requested

# Semantic Conventions

All attributes follow OpenTelemetry HTTP Semantic Conventions v1.23.0+ (stable).

## Stability Status

**Stable Attributes** (use these):
- `http.request.method`
- `http.response.status_code`
- `server.address`
- `server.port`
- `url.path`
- `url.query`
- `url.scheme`
- `url.full`
- `network.protocol.version`
- `error.type`

**Experimental Attributes** (avoid for now):
- `http.request.body.size`
- `http.response.body.size`
- `http.request.size`
- `http.response.size`
- `url.template`

## HTTP Client (Fetch) Attributes

### Required Attributes (onOperationStart)

| Attribute | Type | Example | Notes |
|-----------|------|---------|-------|
| `http.request.method` | string | `"GET"`, `"POST"`, `"HEAD"` | Uppercase |
| `server.address` | string | `"example.com"`, `"10.1.2.80"` | From URL host |
| `server.port` | int | `80`, `8080`, `443` | From URL port |
| `url.full` | string | `"https://www.foo.bar/search?q=OpenTelemetry"` | Complete URL |

### Conditionally Required Attributes

| Attribute | Type | Condition | Example |
|-----------|------|-----------|---------|
| `http.response.status_code` | int | If response received | `200`, `404`, `500` |
| `error.type` | string | If request failed | `"NetworkError"`, `"TimeoutError"` |
| `network.protocol.name` | string | If not "http" | `"http"`, `"spdy"` |

### Recommended Attributes

| Attribute | Type | Example | Notes |
|-----------|------|---------|-------|
| `network.protocol.version` | string | `"1.0"`, `"1.1"`, `"2"`, `"3"` | HTTP version |
| `url.path` | string | `"/search"` | Path component |
| `url.query` | string | `"q=OpenTelemetry"` | Query string (without `?`) |
| `url.scheme` | string | `"http"`, `"https"` | Scheme |

### Optional Attributes

| Attribute | Type | Example | Notes |
|-----------|------|---------|-------|
| `http.request.header.<key>` | string | `"application/json"` | Per `captureAttributes` |
| `http.response.header.<key>` | string | `"application/json"` | Per `captureAttributes` |
| `user_agent.original` | string | `"Mozilla/5.0..."` | From `user-agent` header |

## HTTP Server Attributes

### Required Attributes (onOperationStart)

| Attribute | Type | Example | Notes |
|-----------|------|---------|-------|
| `http.request.method` | string | `"GET"`, `"POST"` | Uppercase |
| `url.path` | string | `"/search"` | Path component |
| `url.scheme` | string | `"http"`, `"https"` | Scheme |

### Conditionally Required Attributes

| Attribute | Type | Condition | Example |
|-----------|------|-----------|---------|
| `http.response.status_code` | int | If response sent | `200`, `404`, `500` |
| `error.type` | string | If request failed | `"InternalError"`, `500` |
| `url.query` | string | If present in URL | `"q=OpenTelemetry"` |
| `server.port` | int | If available | `80`, `8080`, `443` |
| `http.route` | string | If available | `"/users/:id"` |
| `network.protocol.name` | string | If not "http" | `"http"`, `"spdy"` |

### Recommended Attributes

| Attribute | Type | Example | Notes |
|-----------|------|---------|-------|
| `client.address` | string | `"83.164.160.102"` | Remote IP |
| `server.address` | string | `"example.com"` | Host header |
| `network.protocol.version` | string | `"1.1"`, `"2"` | HTTP version |
| `user_agent.original` | string | `"Mozilla/5.0..."` | From `user-agent` header |

### Optional Attributes

| Attribute | Type | Example | Notes |
|-----------|------|---------|-------|
| `http.request.header.<key>` | string | `"application/json"` | Per `captureAttributes` |
| `http.response.header.<key>` | string | `"application/json"` | Per `captureAttributes` |
| `client.port` | int | `65123` | Remote port |

## Distributed Tracing Attributes

These attributes are extracted from the W3C `traceparent` header on incoming requests:

| Attribute | Type | Example | Notes |
|-----------|------|---------|-------|
| `trace.parent.trace_id` | string | `"4bf92f3577b34da6a3ce929d0e0e4736"` | 32 hex chars |
| `trace.parent.span_id` | string | `"00f067aa0ba902b7"` | 16 hex chars |
| `trace.parent.trace_flags` | number | `1` (sampled), `0` (not sampled) | 8-bit flags |

## Error Attributes

| Attribute | Type | Example | Notes |
|-----------|------|---------|-------|
| `error.type` | string | `"NetworkError"`, `"TimeoutError"`, `"500"` | Error class or status code |
| `error.message` | string | `"Connection timeout after 30s"` | Human-readable message |
| `error.stack_trace` | string | `"Error: ...\n  at ..."` | Stack trace (optional) |

## Operation Metadata

Non-standard attributes for operation tracking:

| Attribute | Type | Example | Notes |
|-----------|------|---------|-------|
| `operation.id` | number | `12345678` | Unique operation ID |
| `operation.timestamp` | number | `1640000000000000000` | Nanoseconds since epoch |
| `operation.duration` | number | `1234567890` | Nanoseconds elapsed |

# Implementation Details

## HTTP Server Instrumentation Points

### File: `src/bun.js/api/server.zig`

**Insertion Points**:

1. **Operation Start** - After request headers parsed, before user handler:
```zig
// In request handler (after headers available)
pub fn onRequest(req: *uws.Request, resp: *Response) void {
    if (bun.telemetry.enabled()) |otel| {
        // Build URL from request
        const url = req.getUrl();
        const method = req.getMethod();
        const headers_js = buildHeadersJSValue(req, globalObject);

        // Notify start
        notifyHttpRequestStart(&ctx.telemetry, globalObject, method, url, headers_js);
    }

    // Call user handler
    handler.call(request, response);
}
```

2. **Operation End** - After response sent, before cleanup:
```zig
// In response finalizer
pub fn finalizeWithoutDeinit(this: *Response) void {
    const status_code = this.statusCode();
    const content_length = this.body.len;

    notifyHttpRequestEnd(&this.ctx.telemetry, globalObject, status_code, content_length);
}
```

3. **Operation Error** - When handler rejects:
```zig
// In error handler
pub fn onHandlerError(ctx: *RequestContext, error_value: JSValue) void {
    notifyHttpRequestError(&ctx.telemetry, globalObject, error_value);
}
```

4. **Header Injection** - In renderMetadata (before sending response):
```zig
// In Response.renderMetadata()
pub fn renderMetadata(this: *Response, resp: *uws.Response) void {
    // ... write normal headers ...

    // MUST be called LAST (after all other headers)
    if (this.ctx.telemetry.isEnabled()) {
        renderInjectedTraceHeadersToUWSResponse(
            .http,
            this.ctx.telemetry.op_id,
            .js_undefined,
            resp,
            globalObject
        );
    }
}
```

### Memory Considerations

**RequestContext Storage** (src/bun.js/api/server/RequestContext.zig):
```zig
pub const RequestContext = struct {
    // Existing fields...

    /// Telemetry state for this request (16 bytes)
    telemetry: HttpTelemetryContext = .{},
};
```

**Size Impact**:
- `HttpTelemetryContext`: 16 bytes (OpId op_id + u64 start_time_ns)
- No additional heap allocations per request
- Stack-allocated `AttributeMap` in notification functions

## HTTP Client (Fetch) Instrumentation Points

### File: `src/bun.js/api/fetch.zig`

**Insertion Points**:

1. **Operation Start** - In `fetch()` before sending request:
```zig
// In AsyncHTTP.queue()
pub fn queue(this: *AsyncHTTP, allocator: std.mem.Allocator, batch: *ThreadPool.Batch) !void {
    // After building request headers, before sending
    this.telemetry_op_id = telemetry_fetch.notifyFetchStart(
        globalObject,
        this.method,
        this.url.href,
        &this.request_headers, // Mutable for injection
    );
    this.telemetry_start_time_ns = @intCast(std.time.nanoTimestamp());

    // Continue with request...
}
```

2. **Operation End** - After response received successfully:
```zig
// In AsyncHTTP.onResolve()
pub fn onResolve(this: *AsyncHTTP) void {
    telemetry_fetch.notifyFetchEnd(
        globalObject,
        this.telemetry_op_id,
        this.telemetry_start_time_ns,
        this.metadata,
        this.response_buffer,
    );
}
```

3. **Operation Error** - When request fails:
```zig
// In AsyncHTTP.onReject()
pub fn onReject(this: *AsyncHTTP, err: anyerror) void {
    telemetry_fetch.notifyFetchError(
        globalObject,
        this.telemetry_op_id,
        this.telemetry_start_time_ns,
        err,
        this.error_message,
        this.metadata,
    );
}
```

### Memory Considerations

**AsyncHTTP Storage**:
```zig
pub const AsyncHTTP = struct {
    // Existing fields...

    /// Telemetry tracking (16 bytes)
    telemetry_op_id: OpId = 0,
    telemetry_start_time_ns: u64 = 0,
};
```

**Size Impact**:
- 16 bytes per in-flight fetch request
- No heap allocations
- Headers injected directly into existing `request_headers` structure

## Zero-Overhead When Disabled

When telemetry is disabled (`bun.telemetry.enabled()` returns `null`):

```zig
// This code:
if (bun.telemetry.enabled()) |otel| {
    notifyHttpRequestStart(&ctx.telemetry, globalObject, method, url, headers);
}

// Compiles to (when disabled):
if (false) {
    // Dead code, completely eliminated by optimizer
}

// Which optimizes to:
// (nothing - zero instructions)
```

**Performance Target**: <0.1% overhead when telemetry disabled

# Expected Behavior

## HTTP Server Request Lifecycle

### 1. Incoming Request with Traceparent

**Request**:
```http
GET /api/users?role=admin HTTP/1.1
Host: example.com
User-Agent: Mozilla/5.0
Content-Type: application/json
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

**onOperationStart Attributes**:
```javascript
{
  "operation.id": 12345678,
  "operation.timestamp": 1640000000000000000,
  "http.request.method": "GET",
  "url.path": "/api/users",
  "url.query": "role=admin",
  "url.scheme": "http",
  "url.full": "http://example.com/api/users?role=admin",
  "server.address": "example.com",
  "http.request.header.user-agent": "Mozilla/5.0", // if captured
  "http.request.header.content-type": "application/json", // if captured
  "trace.parent.trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "trace.parent.span_id": "00f067aa0ba902b7",
  "trace.parent.trace_flags": 1
}
```

**onOperationEnd Attributes**:
```javascript
{
  "http.response.status_code": 200,
  "http.response.body.size": 1234,
  "operation.duration": 50000000, // 50ms in nanoseconds
  "http.response.header.content-type": "application/json" // if captured
}
```

**Response Headers** (if `injectHeaders.response: ["traceparent"]`):
```http
HTTP/1.1 200 OK
Content-Type: application/json
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-abc123def4567890-01
```

### 2. Request Error

**onOperationError Attributes**:
```javascript
{
  "error.type": "TypeError",
  "error.message": "Cannot read property 'foo' of undefined",
  "error.stack_trace": "TypeError: Cannot read property 'foo' of undefined\n  at handler (index.ts:10)",
  "http.response.status_code": 500, // if response was sent
  "operation.duration": 1234567
}
```

## HTTP Client (Fetch) Lifecycle

### 1. Outgoing Request with Header Injection

**JavaScript**:
```javascript
await fetch("https://api.example.com/data?limit=10", {
  method: "POST",
  headers: { "Content-Type": "application/json" }
});
```

**onOperationStart Attributes**:
```javascript
{
  "operation.id": 23456789,
  "operation.timestamp": 1640000001000000000,
  "http.request.method": "POST",
  "url.full": "https://api.example.com/data?limit=10",
  "url.path": "/data",
  "url.query": "limit=10",
  "url.scheme": "https",
  "server.address": "api.example.com",
  "server.port": 443,
  "http.request.header.content-type": "application/json" // if captured
}
```

**Injected Request Headers** (if `injectHeaders.request: ["traceparent"]`):
```http
POST /data?limit=10 HTTP/1.1
Host: api.example.com
Content-Type: application/json
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-def456abc1234567-01
```

**onOperationEnd Attributes**:
```javascript
{
  "http.response.status_code": 200,
  "http.response.body.size": 567,
  "operation.duration": 120000000 // 120ms
}
```

### 2. Fetch Error

**onOperationError Attributes**:
```javascript
{
  "error.type": "NetworkError",
  "error.message": "Connection timeout after 30s",
  "operation.duration": 30000000000 // 30s in nanoseconds
}
```

# Test Cases

## TypeScript Test Cases (test/js/bun/telemetry/)

### Test: HTTP Server - Basic Attributes

```typescript
test("HTTP server onOperationStart receives correct attributes", async () => {
  let startAttrs: any;

  Bun.telemetry.attach({
    type: "http",
    name: "test",
    version: "1.0.0",
    onOperationStart(id, attributes) {
      startAttrs = attributes;
    },
  });

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("OK");
    },
  });

  await fetch(`http://localhost:${server.port}/api/users?role=admin`);

  expect(startAttrs).toMatchObject({
    "http.request.method": "GET",
    "url.path": "/api/users",
    "url.query": "role=admin",
    "url.scheme": "http",
    "operation.id": expect.any(Number),
    "operation.timestamp": expect.any(Number),
  });

  server.stop();
});
```

### Test: HTTP Server - Traceparent Extraction

```typescript
test("HTTP server extracts traceparent header", async () => {
  let startAttrs: any;

  Bun.telemetry.attach({
    type: "http",
    name: "test",
    version: "1.0.0",
    onOperationStart(id, attributes) {
      startAttrs = attributes;
    },
  });

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("OK");
    },
  });

  await fetch(`http://localhost:${server.port}/test`, {
    headers: {
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
  });

  expect(startAttrs).toMatchObject({
    "trace.parent.trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
    "trace.parent.span_id": "00f067aa0ba902b7",
    "trace.parent.trace_flags": 1,
  });

  server.stop();
});
```

### Test: HTTP Server - Invalid Traceparent

```typescript
test("HTTP server ignores invalid traceparent header", async () => {
  let startAttrs: any;

  Bun.telemetry.attach({
    type: "http",
    name: "test",
    version: "1.0.0",
    onOperationStart(id, attributes) {
      startAttrs = attributes;
    },
  });

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("OK");
    },
  });

  await fetch(`http://localhost:${server.port}/test`, {
    headers: {
      "traceparent": "invalid-format",
    },
  });

  // Should NOT have trace.parent.* attributes
  expect(startAttrs["trace.parent.trace_id"]).toBeUndefined();

  server.stop();
});
```

### Test: Fetch Client - Header Injection

```typescript
test("Fetch client injects traceparent header", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(JSON.stringify({
        traceparent: req.headers.get("traceparent"),
      }));
    },
  });

  Bun.telemetry.attach({
    type: "fetch",
    name: "test",
    version: "1.0.0",
    injectHeaders: {
      request: ["traceparent"],
    },
    onOperationInject(id, data) {
      // Return array matching injectHeaders.request order: ["traceparent"]
      return [
        "00-abc123def456-fedcba987654-01",  // traceparent
      ];
    },
  });

  const response = await fetch(`http://localhost:${server.port}/test`);
  const body = await response.json();

  expect(body.traceparent).toBe("00-abc123def456-fedcba987654-01");

  server.stop();
});
```

### Test: Fetch Client - Error Handling

```typescript
test("Fetch client onOperationError receives error attributes", async () => {
  let errorAttrs: any;

  Bun.telemetry.attach({
    type: "fetch",
    name: "test",
    version: "1.0.0",
    onOperationError(id, attributes) {
      errorAttrs = attributes;
    },
  });

  try {
    await fetch("http://invalid-host-that-does-not-exist.test:99999");
  } catch (err) {
    // Expected to fail
  }

  expect(errorAttrs).toMatchObject({
    "error.type": expect.any(String),
    "error.message": expect.any(String),
    "operation.duration": expect.any(Number),
  });
});
```

### Test: Header Capture Configuration

```typescript
test("captureAttributes filters headers correctly", async () => {
  let startAttrs: any;

  Bun.telemetry.attach({
    type: "http",
    name: "test",
    version: "1.0.0",
    captureAttributes: {
      requestHeaders: ["x-custom-header"], // Only capture this header
    },
    onOperationStart(id, attributes) {
      startAttrs = attributes;
    },
  });

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("OK");
    },
  });

  await fetch(`http://localhost:${server.port}/test`, {
    headers: {
      "x-custom-header": "custom-value",
      "x-other-header": "should-not-be-captured",
    },
  });

  expect(startAttrs["http.request.header.x-custom-header"]).toBe("custom-value");
  expect(startAttrs["http.request.header.x-other-header"]).toBeUndefined();

  server.stop();
});
```

### Test: Blocked Headers Security

```typescript
test("Blocked headers are rejected at attach time", () => {
  expect(() => {
    Bun.telemetry.attach({
      type: "http",
      name: "test",
      version: "1.0.0",
      captureAttributes: {
        requestHeaders: ["authorization"], // Blocked header
      },
    });
  }).toThrow(TypeError); // "authorization" is a blocked header
});

test("Blocked headers cannot be injected", () => {
  expect(() => {
    Bun.telemetry.attach({
      type: "fetch",
      name: "test",
      version: "1.0.0",
      injectHeaders: {
        request: ["cookie"], // Blocked header
      },
    });
  }).toThrow(TypeError); // "cookie" is a blocked header
});
```

## Integration Test Cases (packages/bun-otel/test/)

### Test: Full OpenTelemetry Integration

```typescript
import { trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { BunHttpInstrumentation } from "bun-otel";

test("creates HTTP server span with correct attributes", async () => {
  const provider = new NodeTracerProvider();
  const exporter = new InMemorySpanExporter();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  provider.register();

  const instrumentation = new BunHttpInstrumentation();
  instrumentation.enable();

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("OK");
    },
  });

  await fetch(`http://localhost:${server.port}/api/users?role=admin`, {
    headers: {
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
  });

  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);

  const span = spans[0];
  expect(span.attributes).toMatchObject({
    "http.request.method": "GET",
    "url.path": "/api/users",
    "url.query": "role=admin",
    "http.response.status_code": 200,
  });

  expect(span.spanContext().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  expect(span.parentSpanId).toBe("00f067aa0ba902b7");

  server.stop();
});
```

### Test: Distributed Tracing Propagation

```typescript
test("propagates trace context from client to server", async () => {
  const provider = new NodeTracerProvider();
  const exporter = new InMemorySpanExporter();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  provider.register();

  const httpInstrumentation = new BunHttpInstrumentation();
  const fetchInstrumentation = new BunFetchInstrumentation();
  httpInstrumentation.enable();
  fetchInstrumentation.enable();

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      // Server should see trace context from client
      return new Response(req.headers.get("traceparent"));
    },
  });

  // Make fetch request (client span)
  const tracer = trace.getTracer("test");
  await tracer.startActiveSpan("client-request", async (span) => {
    const response = await fetch(`http://localhost:${server.port}/test`);
    const traceparent = await response.text();

    // Verify client injected traceparent
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);

    span.end();
  });

  const spans = exporter.getFinishedSpans();

  // Should have both client and server spans
  const clientSpan = spans.find(s => s.name === "client-request");
  const serverSpan = spans.find(s => s.attributes["http.request.method"] === "GET");

  expect(clientSpan).toBeDefined();
  expect(serverSpan).toBeDefined();

  // Server span should be child of client span
  expect(serverSpan.spanContext().traceId).toBe(clientSpan.spanContext().traceId);
  expect(serverSpan.parentSpanId).toBe(clientSpan.spanContext().spanId);

  server.stop();
});
```

# Environment Variables

All configuration properties can be set via environment variables:

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `BUN_OTEL_HTTP_CAPTURE_HEADERS_FETCH_REQUEST` | `content-type,content-length,user-agent,accept` | Fetch request headers to capture |
| `BUN_OTEL_HTTP_CAPTURE_HEADERS_FETCH_RESPONSE` | `content-type,content-length` | Fetch response headers to capture |
| `BUN_OTEL_HTTP_CAPTURE_HEADERS_SERVER_REQUEST` | `content-type,content-length,user-agent,accept` | Server request headers to capture |
| `BUN_OTEL_HTTP_CAPTURE_HEADERS_SERVER_RESPONSE` | `content-type,content-length` | Server response headers to capture |
| `BUN_OTEL_HTTP_PROPAGATE_HEADERS_FETCH_REQUEST` | `traceparent,tracestate` | Headers to inject in fetch requests |
| `BUN_OTEL_HTTP_PROPAGATE_HEADERS_SERVER_RESPONSE` | (empty) | Headers to inject in server responses |

**Format**: Comma-separated list (case-insensitive, whitespace trimmed)

**Example**:
```bash
export BUN_OTEL_HTTP_CAPTURE_HEADERS_SERVER_REQUEST="content-type,x-request-id,x-correlation-id"
export BUN_OTEL_HTTP_PROPAGATE_HEADERS_SERVER_RESPONSE="traceparent"
```

# Related Documents

- `specs/001-opentelemetry-support/contracts/telemetry-context.md` - Base TelemetryContext API
- `specs/001-opentelemetry-support/contracts/bun-telemetry-api.md` - Public Bun.telemetry API
- `specs/001-opentelemetry-support/contracts/hook-lifecycle.md` - Hook specifications and attributes
- `specs/001-opentelemetry-support/contracts/attributes.md` - AttributeList contract
- `specs/001-opentelemetry-support/data-model.md` - Overall data model

# References

- [OpenTelemetry HTTP Semantic Conventions v1.23.0+](https://opentelemetry.io/docs/specs/semconv/http/)
- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry Attributes Specification](https://opentelemetry.io/docs/specs/otel/common/attribute-naming/)
- [Node.js HTTP Instrumentation](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-instrumentation-http)
