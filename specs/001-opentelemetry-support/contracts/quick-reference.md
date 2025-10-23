# OpenTelemetry Contracts - Quick Reference

**Purpose**: Critical API surfaces and patterns for implementing OpenTelemetry support in Bun.

## Core Enums & Types

### InstrumentKind (Zig & TypeScript)

```zig
// src/telemetry/main.zig
pub const InstrumentKind = enum(u8) {
    custom = 0,
    http = 1,
    fetch = 2,
    sql = 3,
    redis = 4,
    s3 = 5,
    pub const COUNT = @typeInfo(InstrumentKind).Enum.fields.len;
};
```

```typescript
// Internal (packages/bun-otel/types.ts)
export enum InstrumentKind {
  Custom = 0, HTTP = 1, Fetch = 2, SQL = 3, Redis = 4, S3 = 5,
}

// Public API (packages/bun-types/telemetry.d.ts)
export type InstrumentKind = "http" | "fetch" | "sql" | "redis" | "s3";
```

### ConfigurationProperty

```zig
// src/telemetry/config.zig
pub const ConfigurationProperty = enum(u8) {
    RESERVED = 0,
    http_capture_headers_server_request = 1,
    http_capture_headers_server_response = 2,
    http_propagate_headers_server_response = 3,
    http_capture_headers_fetch_request = 4,
    http_capture_headers_fetch_response = 5,
    http_propagate_headers_fetch_request = 6,
};
```

### OpId Type

```typescript
// Internal branded type for type safety
export type OpId = number & { readonly __brand: 'OpId' };

// Zig: u64, converted to JS number (53-bit safe)
```

## Zig Implementation Patterns

### Standard Instrumentation Pattern

```zig
// ALWAYS check if enabled first (zero-cost when disabled)
if (bun.telemetry.enabled()) |otel| {
    const op_id = otel.generateId();

    // Stack-allocated, no cleanup needed
    var attrs = otel.createAttributeMap();
    attrs.set(otel.semconv.http_request_method, method);
    attrs.set(otel.semconv.url_path, path);

    // Pass by pointer, no ownership transfer
    otel.notifyOperationStart(.http, op_id, &attrs);

    // Store for later use
    ctx.telemetry_op_id = op_id;
}

// Later, in response handler
if (bun.telemetry.enabled()) |otel| {
    if (ctx.telemetry_op_id) |op_id| {
        var attrs = otel.createAttributeMap();
        attrs.set(otel.semconv.http_response_status_code, JSValue.jsNumber(status));
        otel.notifyOperationEnd(.http, op_id, &attrs);
    }
}
```

### Header Injection Pattern (HTTP)

```zig
// For HTTP server responses
renderInjectedTraceHeadersToUWSResponse(
    .http,           // InstrumentKind
    op_id,           // From generateId()
    .js_undefined,   // Context data
    resp,            // uws Response
    globalObject
);

// For fetch client requests
injectFetchHeaders(
    &request_headers,  // Mutable headers
    op_id,
    globalObject
);
```

**For HTTP implementation details**: See `telemetry-http.md`

### Memory Annotations (CRITICAL)

```zig
// EVERY allocation must be annotated
const ptr = allocator.create(SomeType) catch {
    // TODO OTEL_MALLOC - REVIEW
    return error.OutOfMemory;
};

// After human review, replace with:
const ptr = allocator.create(SomeType) catch {
    // OTEL_MALLOC - Startup only, freed in deinit()
    return error.OutOfMemory;
};
```

## TypeScript Public API

### Bun.telemetry.attach()

```typescript
interface NativeInstrument {
  type: InstrumentKind;       // Required: "http", "fetch", etc.
  name: string;                // Required: e.g., "@opentelemetry/instrumentation-http"
  version: string;             // Required: e.g., "1.0.0"

  // Optional: Headers to READ from requests/responses
  captureAttributes?: {
    requestHeaders?: string[];   // Default: ["content-type", "user-agent", "accept", "content-length"]
    responseHeaders?: string[];  // Default: ["content-type", "content-length"]
  };

  // Optional: Headers to WRITE for distributed tracing
  injectHeaders?: {
    request?: string[];   // For fetch: Default ["traceparent", "tracestate"]
    response?: string[];  // For HTTP server: Default []
  };

  // Lifecycle hooks (at least one required)
  onOperationStart?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationProgress?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationEnd?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationError?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationInject?: (id: OpId, data?: unknown) => any; // Returns object with header values
}

// Usage
const instrumentRef = Bun.telemetry.attach({
  type: "http",
  name: "@opentelemetry/instrumentation-http",
  version: "0.1.0",

  captureAttributes: {
    requestHeaders: ["x-request-id"],  // READ these headers
  },

  injectHeaders: {
    response: ["traceparent"],         // WRITE these headers
  },

  onOperationStart(id, attrs) {
    // attrs includes http.request.method, url.path, etc.
  },

  onOperationInject(id, data) {
    // Return object with header values (NOT array)
    return {
      "traceparent": `00-${traceId}-${spanId}-01`
    };
  }
});

// Later: detach
Bun.telemetry.detach(instrumentRef);
```

**For complete hook lifecycle**: See `hook-lifecycle.md`

## TypeScript Internal Bridge (nativeHooks)

```typescript
// INTERNAL API - Not for public use
// Used by TypeScript bridge implementations only

// Check if instrumentation needed
if (!Bun.telemetry.nativeHooks.isEnabledFor(InstrumentKind.HTTP)) {
  return; // Early return, no instrumentation
}

// Generate operation ID
const opId = Bun.telemetry.nativeHooks.generateId();

// Notify hooks
Bun.telemetry.nativeHooks.notifyStart(InstrumentKind.HTTP, opId, attributes);
Bun.telemetry.nativeHooks.notifyEnd(InstrumentKind.HTTP, opId, attributes);
Bun.telemetry.nativeHooks.notifyError(InstrumentKind.HTTP, opId, attributes);
Bun.telemetry.nativeHooks.notifyProgress(InstrumentKind.HTTP, opId, attributes);

// Get header values for injection
const values = Bun.telemetry.nativeHooks.notifyInject(InstrumentKind.Fetch, opId, context);

// Get/set configuration
const headers = Bun.telemetry.nativeHooks.getConfigurationProperty(
  ConfigurationProperty.http_capture_headers_server_request
);
```

**For bridge implementation**: See `telemetry-global.md`

## Attribute Naming Conventions

### Required HTTP Attributes

```javascript
// HTTP Server - onOperationStart
{
  "operation.id": 12345678,              // Always included
  "operation.timestamp": 1640000000000,  // Nanoseconds
  "http.request.method": "GET",          // Uppercase
  "url.path": "/api/users",
  "url.query": "role=admin",             // Without ?
  "url.scheme": "http",
  "server.address": "example.com",

  // If traceparent header present
  "trace.parent.trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "trace.parent.span_id": "00f067aa0ba902b7",
  "trace.parent.trace_flags": 1,

  // Captured headers (per captureAttributes config)
  "http.request.header.content-type": "application/json",
  "http.request.header.x-request-id": "abc123"
}

// HTTP Server - onOperationEnd
{
  "http.response.status_code": 200,
  "operation.duration": 50000000,  // Nanoseconds
  "http.response.header.content-type": "application/json"
}

// Error attributes
{
  "error.type": "TypeError",
  "error.message": "Cannot read property 'foo' of undefined",
  "error.stack_trace": "..."  // Optional
}
```

**For complete attribute reference**: See `hook-lifecycle.md` and `telemetry-http.md`

## Security: Blocked Headers

These headers are **ALWAYS blocked** from capture or injection:
- `authorization`, `proxy-authorization`
- `cookie`, `set-cookie`
- `api-key`, `x-api-key`, `api-token`, `x-auth-token`
- `x-csrf-token`
- `session-id`, `session-token`

Validation happens at `attach()` time - throws `TypeError` if blocked header requested.

## Environment Variables

```bash
# HTTP Header Capture (READ)
BUN_OTEL_HTTP_CAPTURE_HEADERS_SERVER_REQUEST=content-type,x-request-id
BUN_OTEL_HTTP_CAPTURE_HEADERS_SERVER_RESPONSE=content-type
BUN_OTEL_HTTP_CAPTURE_HEADERS_FETCH_REQUEST=content-type,user-agent
BUN_OTEL_HTTP_CAPTURE_HEADERS_FETCH_RESPONSE=content-type

# HTTP Header Injection (WRITE)
BUN_OTEL_HTTP_PROPAGATE_HEADERS_FETCH_REQUEST=traceparent,tracestate
BUN_OTEL_HTTP_PROPAGATE_HEADERS_SERVER_RESPONSE=traceparent

# OpenTelemetry Standard
OTEL_SERVICE_NAME=my-bun-app
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_TRACES_SAMPLER=parentbased_always_on
OTEL_METRICS_EXPORTER=prometheus
```

**For complete ENV variable list**: See `BunSDK.md`

## BunSDK (High-Level API)

```typescript
import { BunSDK } from "bun-otel";

// Minimal setup (uses ENV vars)
const sdk = new BunSDK();
sdk.start();

// Custom configuration
const sdk = new BunSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: "my-app"
  }),
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces"
  }),
  // Auto-registers BunHttpInstrumentation, BunFetchInstrumentation
});

sdk.start();

// Shutdown
await sdk.shutdown();
```

**For SDK configuration**: See `BunSDK.md`

## Implementation Insertion Points

### HTTP Server (src/bun.js/api/server.zig)

```zig
// 1. After request headers parsed
pub fn onRequest(req: *uws.Request, resp: *Response) void {
    // INSERT: notifyHttpRequestStart()
}

// 2. After response sent
pub fn finalizeWithoutDeinit(this: *Response) void {
    // INSERT: notifyHttpRequestEnd()
}

// 3. On error
pub fn onHandlerError(ctx: *RequestContext, error_value: JSValue) void {
    // INSERT: notifyHttpRequestError()
}

// 4. Before sending response (for header injection)
pub fn renderMetadata(this: *Response, resp: *uws.Response) void {
    // ... existing headers ...
    // INSERT LAST: renderInjectedTraceHeadersToUWSResponse()
}
```

### Fetch Client (src/bun.js/api/fetch.zig)

```zig
// 1. Before sending request
pub fn queue(this: *AsyncHTTP, allocator: std.mem.Allocator, batch: *ThreadPool.Batch) !void {
    // INSERT: notifyFetchStart() - returns op_id
    // Modifies request_headers for injection
}

// 2. After response received
pub fn onResolve(this: *AsyncHTTP) void {
    // INSERT: notifyFetchEnd()
}

// 3. On error
pub fn onReject(this: *AsyncHTTP, err: anyerror) void {
    // INSERT: notifyFetchError()
}
```

**For detailed insertion patterns**: See `telemetry-http.md`

## Error Handling Rules

### Configuration Errors (attach time)
- **Action**: Throw/raise immediately
- **Examples**: Invalid instrument, blocked headers

### Runtime Errors (operation time)
- **Action**: Log to stderr (rate-limited), continue operation
- **Examples**: Hook exceptions, attribute building failures

### Resource Errors (OOM)
- **Action**: Silent failure, no logging
- **Examples**: AttributeKey allocation failure

**For error handling details**: See `hook-lifecycle.md`

## Performance Targets

- **Disabled**: <0.1% overhead (unmeasurable)
- **Enabled**: <5% overhead for HTTP workloads
- **Per hook**: ~100ns invocation
- **Memory**: <1KB per request

## Testing Checklist

### Unit Tests (test/js/bun/telemetry/)
- [ ] Hook invocation with correct attributes
- [ ] Header capture/injection
- [ ] Error handling
- [ ] Security (blocked headers)

### Integration Tests (packages/bun-otel/test/)
- [ ] Full OpenTelemetry SDK integration
- [ ] Distributed tracing propagation
- [ ] Metrics collection
- [ ] Multiple instruments

### Performance Tests
- [ ] Benchmark with oha/bombardier (not autocannon)
- [ ] Memory leak detection
- [ ] High load stability (10K+ RPS)

## Quick Decision Tree

**Q: Working on Zig instrumentation?**
→ Start with `telemetry-context.md` for API patterns

**Q: Adding new operation type?**
→ Add to InstrumentKind enum, follow `telemetry-http.md` as template

**Q: Implementing TypeScript bridge?**
→ Use `telemetry-global.md` for nativeHooks API

**Q: Building user-facing instrumentation?**
→ Follow `bun-telemetry-api.md` for attach/detach pattern

**Q: Handling attributes?**
→ See `attributes.md` for AttributeKey/AttributeMap design

**Q: Implementing header injection?**
→ Follow two-stage pattern in `header-injection.md`

**Q: Creating SDK wrapper?**
→ Extend pattern from `BunSDK.md`

## Critical Reminders

1. **ALWAYS** check `if (bun.telemetry.enabled())` first
2. **NEVER** allocate on hot path without `// OTEL_MALLOC` annotation
3. **ALWAYS** pass AttributeMap by pointer (`&attrs`)
4. **NEVER** capture blocked headers (authorization, cookie, etc.)
5. **ALWAYS** use comptime InstrumentKind parameter
6. **NEVER** throw from instrumentation hooks
7. **ALWAYS** validate traceparent format per W3C spec
8. **NEVER** keep request objects alive for attributes