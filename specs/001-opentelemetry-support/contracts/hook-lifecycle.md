# Contract: Hook Lifecycle and Attributes

**Feature**: OpenTelemetry Support for Bun
**Component**: Operation Lifecycle Hooks
**Scope**: Critical public API surface for instrumentation
**Audience**: TypeScript instrumentation authors

---

## Design Philosophy

**Core Principle**: Zig layer produces **semantic convention attributes**, TypeScript consumes them.

**Flow**:
```
Zig Runtime → AttributeMap → toJS() → Record<string, any> → Hook → OpenTelemetry Span
```

**Key Invariants**:
1. All hooks receive **attributes** (not custom objects)
2. Attribute keys follow OpenTelemetry semantic conventions
3. Zig performs all mapping and filtering
4. TypeScript sees standard attribute format
5. No conversion needed - direct span.setAttributes(attributes)

---

## NativeInstrument Interface

```typescript
interface NativeInstrument {
  // Required metadata
  type: InstrumentKind;
  name: string;
  version: string;

  // Attribute capture configuration
  captureAttributes?: {
    requestHeaders?: string[];   // HTTP request headers to capture
    responseHeaders?: string[];  // HTTP response headers to capture
    // Future: other attribute filters
  };

  // Lifecycle hooks (at least one required)
  onOperationStart?: (id: number, attributes: Record<string, any>) => void;
  onOperationProgress?: (id: number, attributes: Record<string, any>) => void;
  onOperationEnd?: (id: number, attributes: Record<string, any>) => void;
  onOperationError?: (id: number, attributes: Record<string, any>) => void;
  onOperationInject?: (id: number, data?: unknown) => Record<string, string> | void;
}
```

### captureAttributes Configuration

**Purpose**: Define which headers to capture (deny-by-default security model)

**Default Behavior** (if undefined):
```typescript
{
  requestHeaders: [
    "content-type",
    "content-length",
    "user-agent",
    "accept",
  ],
  responseHeaders: [
    "content-type",
    "content-length",
  ],
}
```

**Custom Configuration**:
```typescript
Bun.telemetry.attach({
  type: InstrumentKind.HTTP,
  name: "my-instrumentation",
  version: "1.0.0",

  captureAttributes: {
    requestHeaders: ["content-type", "x-request-id", "x-correlation-id"],
    responseHeaders: ["content-type", "x-trace-id"],
  },

  onOperationStart(id, attributes) {
    // attributes["http.request.header.x-request-id"] present if header exists
    // attributes["http.request.header.authorization"] NEVER present (blocklist)
  },
});
```

**Validation**:
- Header names must be lowercase strings
- Maximum 50 headers per list (prevent DOS)
- Sensitive headers always blocked (see Security Model section)
- Invalid headers logged and ignored (non-fatal)

---

## Hook Signatures

All hooks receive operation ID and **semantic convention attributes**.

### onOperationStart(id: number, attributes: Record<string, any>): void

Called when operation begins.

**Common Attributes** (all operations):
- `operation.id` (number): Unique operation identifier
- `operation.timestamp` (number): Nanoseconds since epoch

**HTTP-Specific Attributes**:
- `http.request.method` (string): GET, POST, PUT, DELETE, etc.
- `url.full` (string): Complete request URL with query
- `url.path` (string): URL path component
- `url.query` (string): Query string (if present)
- `url.scheme` (string): http or https
- `server.address` (string): Host header value
- `server.port` (number): Server port
- `http.request.header.<name>` (string): Captured request headers

**Distributed Tracing Attributes** (if traceparent header present):
- `trace.parent.trace_id` (string): 128-bit hex trace ID from traceparent
- `trace.parent.span_id` (string): 64-bit hex parent span ID
- `trace.parent.trace_flags` (number): Trace flags (0x01 = sampled)
- `trace.parent.trace_state` (string): Vendor trace state (if present)

**Fetch-Specific Attributes**:
- `http.request.method` (string): HTTP method
- `url.full` (string): Complete target URL
- `http.request.header.<name>` (string): Outgoing headers (if configured)

**Usage**:
```typescript
onOperationStart(id, attributes) {
  const span = tracer.startSpan(attributes["url.path"], {
    kind: SpanKind.SERVER,
    startTime: attributes["operation.timestamp"],
    attributes,  // Direct assignment
  });

  this.spans.set(id, span);
}
```

---

### onOperationProgress(id: number, attributes: Record<string, any>): void

Called during operation execution for incremental updates.

**When Called**:
- HTTP: After response headers sent, before body complete
- Fetch: After response headers received
- SQL: After query plan generated (future)
- Custom: User-defined progress points

**Attributes** (subset of operation-specific attributes):
- `progress.phase` (string): "response_headers_sent" | "response_body_chunk" | ...
- Operation-specific attributes (HTTP status, partial bytes transferred, etc.)

**HTTP Example**:
```typescript
onOperationProgress(id, attributes) {
  const span = this.spans.get(id);
  if (!span) return;

  span.addEvent("response_started", {
    "http.response.status_code": attributes["http.response.status_code"],
  });
}
```

**Usage Notes**:
- May be called 0-N times per operation
- Not guaranteed for all operations
- Attributes are **incremental** (not full operation state)
- Used for long-running operations to show progress

---

### onOperationEnd(id: number, attributes: Record<string, any>): void

Called when operation completes successfully.

**HTTP-Specific Attributes**:
- `http.response.status_code` (number): HTTP status code (200, 404, etc.)
- `http.response.body.size` (number): Response content length in bytes
- `http.response.header.<name>` (string): Captured response headers
- `operation.duration` (number): Total duration in nanoseconds

**Fetch-Specific Attributes**:
- `http.response.status_code` (number): Response status
- `http.response.body.size` (number): Response size
- `http.response.header.<name>` (string): Response headers
- `operation.duration` (number): Total request duration

**Usage**:
```typescript
onOperationEnd(id, attributes) {
  const span = this.spans.get(id);
  if (!span) return;

  span.setAttributes(attributes);
  span.setStatus({ code: SpanStatusCode.OK });
  span.end(attributes["operation.timestamp"] + attributes["operation.duration"]);

  this.spans.delete(id);  // Critical: prevent memory leak
}
```

---

### onOperationError(id: number, attributes: Record<string, any>): void

Called when operation fails.

**Error Attributes**:
- `error.type` (string): Error category
  - HTTP: "ParseError" | "TimeoutError" | "NetworkError" | "InternalError" | "AbortError"
  - Fetch: "NetworkError" | "TimeoutError" | "AbortError" | "DNSError" | "TLSError"
- `error.message` (string): Human-readable error message
- `error.stack_trace` (string): Stack trace (if available)
- `http.response.status_code` (number): Status sent to client (if any)
- `operation.duration` (number): Duration until failure

**Usage**:
```typescript
onOperationError(id, attributes) {
  const span = this.spans.get(id);
  if (!span) return;

  span.recordException({
    name: attributes["error.type"],
    message: attributes["error.message"],
    stack: attributes["error.stack_trace"],
  });

  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: attributes["error.message"],
  });

  span.end();
  this.spans.delete(id);  // Critical: prevent memory leak
}
```

---

### onOperationInject(id: number, data?: unknown): Record<string, string> | void

Called to inject headers into outbound requests (distributed tracing).

**Parameters**:
- `id` (number): Operation ID
- `data` (unknown): Optional custom data (reserved for future use)

**Returns**:
- `Record<string, string>`: Headers to inject
- `void` | `undefined`: No headers to inject

**When Called**:
- HTTP: Before processing request (server receives context)
- Fetch: Before sending request (client propagates context)
- Multiple times OK (instrumentation must cache if expensive)

**Usage**:
```typescript
onOperationInject(id, data) {
  const span = trace.getActiveSpan();
  if (!span) return;

  const { traceId, spanId, traceFlags } = span.spanContext();

  return {
    "traceparent": `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`,
  };
}
```

**Validation**:
- Return value must be plain object or void
- Keys must be valid HTTP header names (lowercase, alphanumeric + hyphen)
- Values must be strings (non-empty, max 8KB per header)
- Maximum 20 headers (prevent DOS)
- Invalid return logged and ignored (non-fatal)

---

## Attribute Reference

### Standard HTTP Server Attributes (OpenTelemetry v1.23.0+)

**Request Phase** (onOperationStart):
```typescript
{
  "operation.id": 123,
  "operation.timestamp": 1698765432123456789,

  // HTTP method and URL
  "http.request.method": "GET",
  "url.full": "http://localhost:3000/api/users?limit=10",
  "url.path": "/api/users",
  "url.query": "limit=10",
  "url.scheme": "http",

  // Server info
  "server.address": "localhost",
  "server.port": 3000,

  // Request headers (if configured)
  "http.request.header.content-type": "application/json",
  "http.request.header.user-agent": "curl/7.68.0",
  "http.request.header.x-request-id": "abc-123",

  // Trace context (if traceparent header present)
  "trace.parent.trace_id": "0af7651916cd43dd8448eb211c80319c",
  "trace.parent.span_id": "b7ad6b7169203331",
  "trace.parent.trace_flags": 1,
}
```

**Response Phase** (onOperationEnd):
```typescript
{
  "http.response.status_code": 200,
  "http.response.body.size": 4567,
  "operation.duration": 12345678,  // nanoseconds

  // Response headers (if configured)
  "http.response.header.content-type": "application/json",
  "http.response.header.x-trace-id": "def-456",
}
```

**Error Phase** (onOperationError):
```typescript
{
  "error.type": "InternalError",
  "error.message": "Cannot read property 'id' of undefined",
  "error.stack_trace": "TypeError: Cannot read...\n  at handler (server.ts:45)",
  "http.response.status_code": 500,  // if sent
  "operation.duration": 8765432,
}
```

### Standard Fetch Client Attributes

**Request Phase** (onOperationStart):
```typescript
{
  "operation.id": 456,
  "operation.timestamp": 1698765432987654321,

  "http.request.method": "POST",
  "url.full": "https://api.example.com/data",
  "url.scheme": "https",
  "server.address": "api.example.com",
  "server.port": 443,

  "http.request.header.content-type": "application/json",
}
```

**Response Phase** (onOperationEnd):
```typescript
{
  "http.response.status_code": 201,
  "http.response.body.size": 1234,
  "operation.duration": 45678901,

  "http.response.header.content-type": "application/json",
}
```

---

## Lifecycle State Machine

```
┌──────────────────┐
│  Operation Start │
└────────┬─────────┘
         │
         ▼
    ┌────────────────────┐
    │ onOperationStart() │ ◄── Attributes with request info
    └────────┬───────────┘
             │
             ▼
    ┌─────────────────────┐
    │ onOperationInject() │ ◄── Called if distributed tracing active
    └────────┬────────────┘     Returns headers to inject
             │
             ▼
    ┌──────────────────────┐
    │  Operation Executing │
    └────────┬─────────────┘
             │
             ▼
    ┌──────────────────────┐
    │ [0-N times]          │
    │ onOperationProgress()│ ◄── Incremental updates during execution
    └────────┬─────────────┘
             │
        ┌────┴────┐
        │         │
        ▼         ▼
   ┌─────────┐ ┌──────────┐
   │ Success │ │  Failure │
   └────┬────┘ └────┬─────┘
        │           │
        ▼           ▼
┌──────────────┐ ┌────────────────┐
│ onOpEnd()    │ │ onOpError()    │ ◄── Attributes with result/error
│              │ │                │
│ (delete id)  │ │ (delete id)    │ ◄── MUST delete from map
└──────────────┘ └────────────────┘
```

**Guarantees**:
1. `onOperationStart` always called first
2. `onOperationProgress` called 0-N times (not guaranteed)
3. `onOperationInject` called 0-N times (instrumentation caches if needed)
4. Exactly ONE of `onOperationEnd` OR `onOperationError` called (never both, never neither)
5. All hooks for same ID called on same thread
6. ID never reused (monotonic counter)

---

## Corner Cases

### 1. Malformed Trace Context Headers

**Scenario**: Client sends invalid `traceparent` header
```
traceparent: invalid-format-here
```

**Behavior**:
- `trace.parent.*` attributes **not included** in onOperationStart
- No error thrown
- Operation proceeds normally
- Instrumentation can handle missing trace context

**Test**:
```typescript
test("invalid traceparent header ignored", async () => {
  let attributes: any;

  Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    onOperationStart(id, attrs) { attributes = attrs; },
  });

  await fetch("http://localhost:3000", {
    headers: { "traceparent": "garbage" },
  });

  expect(attributes["trace.parent.trace_id"]).toBeUndefined();
});
```

---

### 2. Missing Required Attributes

**Scenario**: Zig fails to build attribute (e.g., URL parsing fails)

**Behavior**:
- Attribute omitted (not set to null/undefined)
- Other attributes still present
- Hook still called with partial attributes
- Error logged to stderr (non-fatal)

---

### 3. Very Large Attribute Values

**Scenario**: Response body 500MB, header value 100KB

**Behavior**:
- `http.response.body.size` capped at Number.MAX_SAFE_INTEGER
- Header values truncated at 8KB
- Truncation logged (non-fatal)

**Limits**:
- Header values: 8KB max per header
- URL length: 64KB max
- Error message: 4KB max
- Stack trace: 16KB max

---

### 4. Non-String Header Values

**Scenario**: Header with number/boolean value (protocol violation)

**Behavior**:
- Converted to string via `toString()`
- If conversion fails, attribute omitted
- Logged as warning (non-fatal)

---

### 5. Duplicate Attribute Keys

**Scenario**: Custom attribute conflicts with semantic convention

**Behavior**:
- Semantic convention attributes **always win**
- Custom attributes silently overwritten
- This should never happen (Zig controls all attribute keys)

---

### 6. Null/Undefined Attribute Values

**Scenario**: Optional field not present (e.g., no query string)

**Behavior**:
- Attribute key **not included** in object
- JavaScript sees `!(key in attributes)` → true
- Never set to `null` or `undefined`

**Example**:
```typescript
// URL: http://localhost:3000/api/users (no query)
attributes = {
  "url.path": "/api/users",
  // "url.query" not present
};

"url.query" in attributes  // false (not undefined!)
```

---

### 7. Hook Execution Time Limits

**Scenario**: Hook takes 10 seconds to execute

**Behavior**:
- **No timeout enforced** (hooks run to completion)
- Long-running hooks block request processing
- Instrumentation author responsible for performance
- Future: Consider async hooks or timeout enforcement

**Best Practice**:
```typescript
onOperationStart(id, attributes) {
  // Fast: store in map
  this.spans.set(id, tracer.startSpan("op", { attributes }));

  // DON'T: Slow external API call
  // await fetch("http://slow-api.com/log");  // BLOCKS REQUEST!
}
```

---

## Error Handling

### 1. Hook Throws Exception

**Scenario**:
```typescript
onOperationStart(id, attributes) {
  throw new Error("Oops!");
}
```

**Behavior**:
- Exception caught by Zig wrapper
- Error logged to stderr with instrumentation name
- Request processing **continues normally**
- Other instruments still invoked
- No retry (one attempt only)

**Log Output**:
```
[Telemetry] Error in onOperationStart (@opentelemetry/instrumentation-http v1.0.0): Oops!
  at onOperationStart (instrumentation.ts:45)
```

---

### 2. Invalid onOperationInject Return Value

**Scenario**:
```typescript
onOperationInject(id) {
  return { "invalid header name!": "value" };  // Invalid characters
}
```

**Behavior**:
- Invalid headers filtered out
- Valid headers (if any) still injected
- Error logged (non-fatal)
- Request proceeds

**Validation**:
- Header names: `^[a-z0-9-]+$` (lowercase alphanumeric + hyphen)
- Header values: Non-empty strings, max 8KB
- Max 20 headers total

---

### 3. AttributeMap Building Failure (Zig)

**Scenario**: Memory allocation fails in Zig

**Behavior**:
- Hook **not called** (graceful degradation)
- Request processing **continues normally**
- Error logged to stderr
- Critical: runtime stability over telemetry completeness

---

### 4. JSValue Conversion Failure

**Scenario**: Cannot convert Zig value to JSValue

**Behavior**:
- Attribute omitted from object
- Other attributes still present
- Error logged (non-fatal)

---

## Performance Characteristics

### Overhead Breakdown (HTTP Request)

**Telemetry Disabled** (no instruments attached):
```
isEnabledFor() check:        ~5ns
Early return:                ~2ns
Total per request:           ~7ns (<0.001% overhead)
```

**Telemetry Enabled** (1 instrument attached):
```
isEnabledFor() check:        ~5ns
AttributeMap.init():         ~50ns
Attribute building:
  - URL parsing:             ~200ns
  - Header filtering (4):    ~400ns (100ns each)
  - Trace context parsing:   ~150ns (if present)
  - Struct population:       ~100ns
toJS() conversion:           ~300ns
Hook invocation:             ~100ns
Total per request:           ~1,305ns (~1.3μs)

For 1ms average request:     0.13% overhead ✅
For 100μs fast request:      1.3% overhead  ✅
```

**Memory per Request**:
```
AttributeMap (Zig):          ~64 bytes
JSValue object:              ~200 bytes (typical HTTP attributes)
Span storage (TS):           ~500 bytes
Total:                       ~764 bytes per in-flight request
```

**Cleanup**:
- Attributes eligible for GC after hook completes
- Span deleted from map in onOperationEnd/Error
- No memory leaks if cleanup performed correctly

---

## Security Model

### Header Capture Security

**Blocklist** (always blocked, never captured):
```typescript
const BLOCKED_HEADERS = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "api-key",
  "x-api-key",
  "api-token",
  "x-auth-token",
  "x-csrf-token",
  "session-id",
  "session-token",
];
```

**Enforcement**:
- Blocklist checked **before** allowlist
- Case-insensitive comparison
- Partial matches blocked (e.g., "x-api-key-v2" blocked)
- Zig layer enforces (TypeScript cannot override)

**Validation at Attach Time**:
```typescript
Bun.telemetry.attach({
  captureAttributes: {
    requestHeaders: ["authorization"],  // ❌ REJECTED
  },
});
// Throws TypeError: "authorization" is a blocked header
```

---

### Attribute Injection (XSS Prevention)

**Risk**: Malicious header values injected into attributes

**Mitigation**:
- All attribute values are strings (no objects/functions)
- No eval() or code execution in attribute handling
- Exporters responsible for sanitization before display
- OpenTelemetry spec requires sanitization at export layer

---

### DOS Prevention

**Limits**:
- Max 50 headers in captureAttributes allowlist
- Max 20 headers returned from onOperationInject
- Max 8KB per header value (truncated)
- Max 64KB URL length (truncated)
- Max 100 active instruments (soft limit, logged warning)

---

## AsyncLocalStorage Context Propagation

### How It Works (POC Already Solved This)

**Zig Controls Initial Stack Frame**:
```zig
// src/bun.js/api/server.zig
fn handleRequest(request: *Request) void {
    // Zig creates AsyncLocalStorage stack frame BEFORE calling handler
    const context_store = AsyncLocalStorage.createFrame();
    defer context_store.exit();

    // Now handler executes within context
    callUserHandler(request);
}
```

**TypeScript Sees Correct Context**:
```typescript
// User handler code
Bun.serve({
  async fetch(req) {
    const span = trace.getActiveSpan();  // ✅ Works!

    await Bun.sleep(100);
    const span2 = trace.getActiveSpan(); // ✅ Still works!

    return new Response("OK");
  },
});
```

**No Workaround Needed**:
- AsyncLocalStorage works correctly for all programmatic usage
- `context.with()` works fine
- Only limitation was wrapping request handler (solved by Zig)

---

## Testing Contract

### Validation Tests (test/js/bun/telemetry/)

**Rules**:
- Test ONLY attribute structure and hook calls
- NO `@opentelemetry/*` imports
- Verify attribute keys match semantic conventions
- Validate error handling

**Example**:
```typescript
test("onOperationStart receives HTTP attributes", async () => {
  let capturedAttrs: any;

  Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test",
    version: "1.0.0",
    onOperationStart(id, attributes) {
      capturedAttrs = attributes;
    },
  });

  await fetch("http://localhost:3000/test?foo=bar");

  // Validate semantic convention keys
  expect(capturedAttrs).toMatchObject({
    "http.request.method": "GET",
    "url.path": "/test",
    "url.query": "foo=bar",
    "operation.timestamp": expect.any(Number),
  });
});
```

---

## Integration Tests (packages/bun-otel/test/)

**Rules**:
- Test full OpenTelemetry integration
- CAN import `@opentelemetry/*` packages
- Verify spans created correctly
- Test distributed tracing propagation

**Example**:
```typescript
import { trace } from "@opentelemetry/api";
import { BunHttpInstrumentation } from "@bun/otel";

test("creates spans with correct attributes", async () => {
  const instrumentation = new BunHttpInstrumentation();
  instrumentation.enable();

  const response = await fetch("http://localhost:3000/api/users");

  const spans = memoryExporter.getFinishedSpans();
  expect(spans).toHaveLength(1);

  expect(spans[0].attributes).toMatchObject({
    "http.request.method": "GET",
    "url.path": "/api/users",
    "http.response.status_code": 200,
  });
});
```

---

## Future Extensions

### Planned Additions

1. **Attribute Filtering**:
```typescript
captureAttributes: {
  filters: {
    "http.request.header.*": ["content-type", "user-agent"],
    "http.response.header.*": ["content-type"],
  },
}
```

2. **Custom Attributes**:
```typescript
onOperationStart(id, attributes) {
  // Instrumentation can add custom attributes
  attributes["custom.tenant_id"] = extractTenantId(attributes["url.path"]);
}
```

3. **Async Hooks** (if performance acceptable):
```typescript
onOperationStartAsync?: async (id, attributes) => {
  await logToExternalSystem(attributes);
};
```

4. **Attribute Transformers**:
```typescript
transformAttributes?: (attributes: Record<string, any>) => Record<string, any>;
```

---

## References

- [OpenTelemetry HTTP Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
- [W3C TraceContext Specification](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry Attributes Specification](https://opentelemetry.io/docs/specs/otel/common/attribute-naming/)
