# Contract: Hook Lifecycle and Attributes

**Component**: Operation Lifecycle Hooks
**Scope**: Hook signatures and attribute specifications
**Design Rationale**: [ADR-002](./decisions/ADR-002-hook-lifecycle-design.md)

---

## NativeInstrument Interface

```typescript
// Internal API type - uses branded number for type safety
export type OpId = number & { readonly __brand: 'OpId' };

interface NativeInstrument {
  // Required metadata
  // Note: InstrumentKind here uses the PUBLIC API string literal form
  // ("custom" | "http" | "fetch" | "sql" | "redis" | "s3")
  // NOT the internal numeric enum. See telemetry-global.md for details.
  type: InstrumentKind;
  name: string;
  version: string;

  // Attribute capture configuration
  captureAttributes?: {
    requestHeaders?: string[]; // HTTP request headers to capture
    responseHeaders?: string[]; // HTTP response headers to capture
    // Future: other attribute filters
  };

  // Lifecycle hooks (at least one required)
  onOperationStart?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationProgress?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationEnd?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationError?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationInject?: (
    id: OpId,
    data?: unknown,
  ) => any; // Return value is instrument-specific (HTTP: string[], SQL: different format)
}
```

### captureAttributes Configuration

**Default** (if undefined):

- requestHeaders: `["content-type", "content-length", "user-agent", "accept"]`
- responseHeaders: `["content-type", "content-length"]`

**Validation**:

- MUST: Use lowercase strings
- MUST: Max 50 headers per list
- MUST NOT: Include sensitive headers (always blocked)
- SHOULD: Log and ignore invalid entries (non-fatal)

---

## Hook Signatures

All hooks: `(id: OpId, attributes: Record<string, any>) => void`

### onOperationStart

**When**: Operation begins

**Common Attributes**:
| Attribute | Type | Description |
|-----------|------|-------------|
| operation.id | number | Unique identifier |
| operation.timestamp | number | Nanoseconds since epoch |

**HTTP Server Attributes**:
| Attribute | Type | Example |
|-----------|------|---------|
| http.request.method | string | "GET", "POST" |
| url.full | string | "https://example.com/api?q=test" |
| url.path | string | "/api" |
| url.query | string | "q=test" |
| server.address | string | "example.com" |
| server.port | number | 443 |
| http.request.header.\* | string | Per configured headers |

**Distributed Tracing** (if traceparent present):
| Attribute | Type | Description |
|-----------|------|-------------|
| trace.parent.trace_id | string | 128-bit hex trace ID |
| trace.parent.span_id | string | 64-bit hex parent span |
| trace.parent.trace_flags | number | 0x01 = sampled |

---

### onOperationProgress

**When**: Incremental updates during operation

| Context | Trigger                         |
| ------- | ------------------------------- |
| HTTP    | After response headers sent     |
| Fetch   | After response headers received |
| SQL     | After query plan (future)       |

**Attributes**:
| Attribute | Type | Description |
|-----------|------|-------------|
| progress.phase | string | "response_headers_sent", etc. |
| \* | varies | Operation-specific attributes |

**Notes**:

- MAY: Call 0-N times per operation
- MUST: Provide incremental updates only
- SHOULD: Use for span events

---

### onOperationEnd

**When**: Operation completes successfully

**Common Attributes**:
| Attribute | Type | Description |
|-----------|------|-------------|
| operation.duration | number | Total nanoseconds |
| http.response.status_code | number | HTTP status (200, 404, etc.) |
| http.response.body.size | number | Response bytes |
| http.response.header.\* | string | Per configured headers |

**Requirements**:

- MUST: Delete span from tracking map
- MUST: Set span status to OK
- MUST: Call span.end()

---

### onOperationError

**When**: Operation fails

**Error Attributes**:
| Attribute | Type | Values/Description |
|-----------|------|-------------------|
| error.type | string | "ParseError", "TimeoutError", "NetworkError", etc. |
| error.message | string | Human-readable message |
| error.stack_trace | string | Stack trace (optional) |
| operation.duration | number | Duration until failure |

**Requirements**:

- MUST: Record exception on span
- MUST: Set span status to ERROR
- MUST: Delete span from tracking map

---

### onOperationInject

**Purpose**: Inject headers for distributed tracing (two-stage injection pattern)

**Returns**: Instrument-specific format
- **HTTP instrumentation**: Returns `Record<string, string>` (header name → value object)
- The native layer transforms this to `string[]` (values only) by extracting in config order
- Other instrument kinds may use different formats (e.g., SQL may return connection strings)
- Return `void` or empty object if no injection needed

**When Called**:
| Context | Timing |
|---------|--------|
| HTTP Server | Before processing request |
| Fetch Client | Before sending request |

**Validation**:

- MUST: Return array of strings or void
- MUST: String values only (max 8KB each)
- MUST: Array length matches configured `injectHeaders` length
- SHOULD: Cache if computation expensive

**Design Rationale**: Two-stage injection minimizes memory allocation during hot-path telemetry recording. Header names come from configuration (set once at attach); hooks return only values during each operation.

**Canonical Example**:
```typescript
// If instrument configured with: injectHeaders: { request: ["traceparent", "tracestate"] }
onOperationInject(id, data) {
  const span = trace.getActiveSpan();
  return [
    `00-${span.traceId}-${span.spanId}-01`,  // traceparent value
    `vendor=${span.vendor}`                  // tracestate value
  ];
}
```

---

## Attribute Reference

### HTTP Server Attributes (OpenTelemetry v1.23.0+)

See tables in onOperationStart/End/Error sections above for complete list.

### Fetch Client Attributes

Same as HTTP Server attributes but for outgoing requests.

---

## Lifecycle State Machine

**Hook Order**:

1. `onOperationStart` - Always called first
2. `onOperationInject` - Called 0-N times for header injection
3. `onOperationProgress` - Called 0-N times during execution
4. `onOperationEnd` OR `onOperationError` - Exactly one called

**Guarantees**:

- MUST: Call Start before any other hooks
- MUST: Call exactly one of End or Error
- MUST: Use same thread for all hooks with same ID
- MUST NOT: Reuse operation IDs (monotonic counter)
- MUST: Delete spans from tracking map in End/Error

---

## Corner Cases

| Scenario                   | Behavior                           | Resolution               |
| -------------------------- | ---------------------------------- | ------------------------ |
| Invalid traceparent header | trace.parent.\* attributes omitted | Continue normally        |
| URL parsing fails          | Attribute omitted, others present  | Log error, continue      |
| 500MB response body        | Size capped at MAX_SAFE_INTEGER    | Log truncation           |
| 100KB header value         | Truncated at 8KB                   | Log truncation           |
| Non-string header value    | Convert via toString()             | Omit if fails            |
| Missing optional field     | Key not in attributes object       | Check with `in` operator |
| Hook throws exception      | Caught, logged, request continues  | No retry                 |
| Hook takes 10s             | No timeout, blocks request         | Author responsibility    |

**Attribute Value Limits**:

- Header values: 8KB max
- URL length: 64KB max
- Error message: 4KB max
- Stack trace: 16KB max

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
    requestHeaders: ["authorization"], // ❌ REJECTED
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
    const span = trace.getActiveSpan(); // ✅ Works!

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
import { BunHttpInstrumentation } from "bun-otel";

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

- Attribute filtering patterns
- Custom attribute injection
- Async hooks (if performance acceptable)
- Attribute transformers

---

## References

- [OpenTelemetry HTTP Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
- [W3C TraceContext Specification](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry Attributes Specification](https://opentelemetry.io/docs/specs/otel/common/attribute-naming/)
