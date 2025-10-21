# Contract: Bun.telemetry.nativeHooks API

**Feature**: OpenTelemetry Support for Bun
**Component**: Native Hooks Internal API (Zig ↔ TypeScript Bridge)
**Scope**: Low-level bridge for TypeScript semantic convention handlers
**Audience**: Internal - TypeScript bridge implementations (src/js/internal/telemetry_*.ts)

**Related Contracts**:
- [bun-telemetry-api.md](./bun-telemetry-api.md) - Public API (attach/detach)
- [hook-lifecycle.md](./hook-lifecycle.md) - Hook specifications and attribute formats
- [header-injection.md](./header-injection.md) - Header injection for distributed tracing

---

## Overview

The `Bun.telemetry.nativeHooks` API is an **internal bridge layer** between Zig native code and TypeScript semantic convention handlers. It is NOT intended for end-user instrumentation code.

**Architecture**:
```
┌─────────────────────────────────────────────────────┐
│ Bun Native Code (Zig)                               │
│  - server.zig (HTTP server)                         │
│  - fetch.zig (Fetch client)                         │
└──────────────┬──────────────────────────────────────┘
               │ Calls TypeScript bridge
               ▼
┌─────────────────────────────────────────────────────┐
│ TypeScript Bridge (src/js/internal/telemetry_*.ts) │
│  - telemetry_http.ts                                │
│  - telemetry_fetch.ts                               │
│  - Builds semantic convention attributes            │
└──────────────┬──────────────────────────────────────┘
               │ Uses nativeHooks
               ▼
┌─────────────────────────────────────────────────────┐
│ Bun.telemetry.nativeHooks (this API)               │
│  - notifyStart/End/Error/Progress/Inject           │
│  - isEnabledFor                                     │
│  - getConfigurationProperty / setConfigurationProperty
└──────────────┬──────────────────────────────────────┘
               │ Dispatches to instruments
               ▼
┌─────────────────────────────────────────────────────┐
│ Registered Instruments (via Bun.telemetry.attach)  │
│  - User-provided hooks                              │
└─────────────────────────────────────────────────────┘
```

---

## API Surface

### `Bun.telemetry.nativeHooks.isEnabledFor(kind: number): boolean`

Fast check if any instruments are registered for an operation kind.

**Parameters**:
- `kind` (number): InstrumentKind enum value (0-5)

**Returns**: `boolean`
- `true` if at least one instrument registered for this kind
- `false` otherwise (safe to skip attribute building)

**Performance**:
- O(1) array length check
- ~5ns overhead
- Used at top of every bridge function for early return

**Example**:
```typescript
// src/js/internal/telemetry_http.ts
export function handleIncomingRequest(req: IncomingMessage, res: ServerResponse) {
  // Early return if no HTTP instruments registered
  if (!nativeHooks.isEnabledFor(InstrumentKind.HTTP)) {
    return;
  }

  // Continue with expensive attribute building...
}
```

---

### `Bun.telemetry.nativeHooks.notifyStart(kind: number, id: number, attributes: object): void`

Notifies all registered instruments of an operation start.

**Parameters**:
- `kind` (number): InstrumentKind enum value
- `id` (number): Unique operation ID (from `performance.now() * 1_000_000 | 0`)
- `attributes` (object): Semantic convention attributes

**Returns**: `void`

**Behavior**:
- Iterates through all instruments registered for `kind`
- Calls each instrument's `onOperationStart(id, attributes)` hook
- Errors in hooks are caught and logged (defensive isolation)
- Execution continues even if one hook throws

**Attribute Format**:
```typescript
// Example HTTP server request attributes
{
  "operation.id": 1234567890,
  "http.request.method": "GET",
  "url.path": "/api/users",
  "url.scheme": "http",
  "server.address": "localhost",
  "server.port": 3000,
  "network.protocol.version": "1.1",
  "user_agent.original": "Mozilla/5.0...",
  // ... additional semantic convention attributes
}
```

**Example**:
```typescript
// src/js/internal/telemetry_http.ts
const operationId = (performance.now() * 1_000_000) | 0;
const attributes = buildRequestAttributes(req, operationId);

nativeHooks.notifyStart(InstrumentKind.HTTP, operationId, attributes);
```

---

### `Bun.telemetry.nativeHooks.notifyEnd(kind: number, id: number, attributes: object): void`

Notifies all registered instruments of an operation completion.

**Parameters**:
- `kind` (number): InstrumentKind enum value
- `id` (number): Same operation ID from `notifyStart`
- `attributes` (object): Final attributes including result data

**Returns**: `void`

**Behavior**:
- Same error handling as `notifyStart`
- `id` must match a previous `notifyStart` call
- Attributes should include final state (status codes, response headers, etc.)

**Attribute Format**:
```typescript
// Example HTTP server response attributes
{
  "operation.id": 1234567890,
  "http.response.status_code": 200,
  "http.response.body.size": 1024,
  "http.response.header.content-type": ["application/json"],
  // ... additional response attributes
}
```

**Example**:
```typescript
// src/js/internal/telemetry_http.ts
res.once("finish", () => {
  const attributes = buildResponseAttributes(res, operationId);
  nativeHooks.notifyEnd(InstrumentKind.HTTP, operationId, attributes);
});
```

---

### `Bun.telemetry.nativeHooks.notifyError(kind: number, id: number, attributes: object): void`

Notifies all registered instruments of an operation error.

**Parameters**:
- `kind` (number): InstrumentKind enum value
- `id` (number): Same operation ID from `notifyStart`
- `attributes` (object): Error details following semantic conventions

**Returns**: `void`

**Behavior**:
- Should be called instead of (not in addition to) `notifyEnd`
- Error attributes follow OpenTelemetry error semantic conventions

**Attribute Format**:
```typescript
// Example error attributes
{
  "operation.id": 1234567890,
  "error.type": "Error",
  "error.message": "Connection reset",
  "error.stack": "Error: Connection reset\n  at...",
  // ... additional error context
}
```

**Example**:
```typescript
// src/js/internal/telemetry_http.ts
res.once("error", (err: unknown) => {
  const attributes = buildErrorAttributes(res, operationId, err);
  nativeHooks.notifyError(InstrumentKind.HTTP, operationId, attributes);
});
```

---

### `Bun.telemetry.nativeHooks.notifyProgress(kind: number, id: number, attributes: object): void`

Notifies all registered instruments of intermediate operation progress.

**Parameters**:
- `kind` (number): InstrumentKind enum value
- `id` (number): Same operation ID from `notifyStart`
- `attributes` (object): Progress-specific attributes

**Returns**: `void`

**Use Cases**:
- Large file uploads/downloads (report bytes transferred)
- Long-running SQL queries (report rows processed)
- Streaming responses (report chunks sent)

**Behavior**:
- Can be called multiple times per operation
- Called between `notifyStart` and `notifyEnd/Error`
- Optional - not all operations have progress events

**Attribute Format**:
```typescript
// Example progress attributes for file upload
{
  "operation.id": 1234567890,
  "http.request.body.bytes_received": 524288,
  "http.request.body.bytes_total": 1048576,
  "progress.percent": 50,
}
```

**Example**:
```typescript
// Future use in streaming scenarios
req.on("data", (chunk: Buffer) => {
  bytesReceived += chunk.length;
  nativeHooks.notifyProgress(InstrumentKind.HTTP, operationId, {
    "operation.id": operationId,
    "http.request.body.bytes_received": bytesReceived,
  });
});
```

---

### `Bun.telemetry.nativeHooks.notifyInject(kind: number, id: number, data: object): any[]`

Collects header injection data from all registered instruments.

**Parameters**:
- `kind` (number): InstrumentKind enum value
- `id` (number): Operation ID
- `data` (object): Context for injection (current headers, URL, etc.)

**Returns**: `any[]`
- Array of injection results from all instruments
- Each instrument's `onOperationInject` return value is included
- Empty array if no instruments or no injections

**Behavior**:
- Calls `onOperationInject(id, data)` on all registered instruments
- Collects non-null/non-undefined return values into array
- Used for distributed tracing header injection (W3C Trace Context)

**Data Format**:
```typescript
// Input data provided to instruments
{
  "operation.id": 1234567890,
  "url.full": "https://api.example.com/users",
  "http.request.method": "GET",
  // ... other context
}
```

**Return Format**:
```typescript
// Example return array from multiple instruments
[
  { "traceparent": "00-abc123-def456-01" },
  { "tracestate": "vendor=value" },
  { "baggage": "key1=value1,key2=value2" },
]
// Bridge layer merges these into headers
```

**Example**:
```typescript
// src/js/internal/telemetry_http.ts
const injections = nativeHooks.notifyInject(InstrumentKind.Fetch, operationId, {
  "operation.id": operationId,
  "url.full": url.href,
  "http.request.method": method,
});

// Merge injected headers into request
for (const injection of injections) {
  if (injection && typeof injection === "object") {
    for (const [key, value] of Object.entries(injection)) {
      headers.set(key, String(value));
    }
  }
}
```

---

### `Bun.telemetry.nativeHooks.getConfigurationProperty(propertyId: number): any`

Retrieves a configuration property value by its enum ID.

**Parameters**:
- `propertyId` (number): ConfigurationProperty enum value (1-6)

**Returns**: `any`
- JSValue for the property (typically an array of strings)
- `undefined` if property not set or invalid ID

**Configuration Properties**:
```typescript
enum ConfigurationProperty {
  RESERVED = 0,  // Always undefined
  http_capture_headers_server_request = 1,
  http_capture_headers_server_response = 2,
  http_propagate_headers_server_response = 3,
  http_capture_headers_fetch_request = 4,
  http_capture_headers_fetch_response = 5,
  http_propagate_headers_fetch_request = 6,
}
```

**Return Format**:
```typescript
// Example return value
["content-type", "content-length", "user-agent"]
```

**Example**:
```typescript
// src/js/internal/telemetry_http.ts
const requestHeaders = nativeHooks.getConfigurationProperty(
  ConfigurationProperty.http_capture_headers_server_request
);

// requestHeaders is now ["content-type", "user-agent", ...] or undefined
if (Array.isArray(requestHeaders)) {
  for (const headerName of requestHeaders) {
    const value = req.headers[headerName];
    if (value !== undefined) {
      attributes[`http.request.header.${headerName}`] = value;
    }
  }
}
```

---

### `Bun.telemetry.nativeHooks.setConfigurationProperty(propertyId: number, value: any): void`

Sets a configuration property value, syncing both JS and native storage.

**Parameters**:
- `propertyId` (number): ConfigurationProperty enum value (1-6)
- `value` (any): New value (typically array of strings, or undefined to clear)

**Returns**: `void`

**Throws**:
```typescript
TypeError: "Cannot set RESERVED property"
TypeError: "Invalid property ID"
TypeError: "Property must be an array of strings"
Error: "Failed to set configuration property"
```

**Behavior**:
- Validates property type (must be array or undefined)
- Unprotects old JSValue if present (allows GC)
- Protects new JSValue (prevents GC)
- Syncs native bun.String array from JS array
- Validates consistency between JS and native storage

**Validation Rules**:
1. `propertyId` must be valid (1-6)
2. Cannot set RESERVED (0)
3. Value must be `undefined`, `null`, or array
4. Array items must be strings
5. Strings are converted to lowercase
6. Duplicate strings are preserved (instruments may need them)

**Example**:
```typescript
// packages/bun-otel configuration parsing
import { nativeHooks, ConfigurationProperty } from "bun:telemetry";

// Parse from environment variable
const captureHeaders = process.env.OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST
  ?.split(",")
  .map(h => h.trim().toLowerCase())
  .filter(Boolean) || [];

// Apply to native layer
nativeHooks.setConfigurationProperty(
  ConfigurationProperty.http_capture_headers_server_request,
  captureHeaders
);
```

---

## Type Definitions

### ConfigurationProperty Enum

**Purpose**: Identifies configuration properties for header capture/propagation.

**Zig Definition**:
```zig
pub const ConfigurationProperty = enum(u8) {
    RESERVED = 0,
    http_capture_headers_server_request = 1,
    http_capture_headers_server_response = 2,
    http_propagate_headers_server_response = 3,
    http_capture_headers_fetch_request = 4,
    http_capture_headers_fetch_response = 5,
    http_propagate_headers_fetch_request = 6,

    pub const COUNT = @typeInfo(ConfigurationProperty).@"enum".fields.len;
};
```

**TypeScript Definition** (packages/bun-types/telemetry.d.ts):
```typescript
export enum ConfigurationProperty {
  RESERVED = 0,
  http_capture_headers_server_request = 1,
  http_capture_headers_server_response = 2,
  http_propagate_headers_server_response = 3,
  http_capture_headers_fetch_request = 4,
  http_capture_headers_fetch_response = 5,
  http_propagate_headers_fetch_request = 6,
}
```

---

## Data Flow Examples

### HTTP Server Request Lifecycle

```typescript
// src/js/internal/telemetry_http.ts

export function handleIncomingRequest(req: IncomingMessage, res: ServerResponse) {
  // 1. Early return check
  if (!nativeHooks.isEnabledFor(InstrumentKind.HTTP)) {
    return;
  }

  // 2. Generate operation ID
  const operationId = (performance.now() * 1_000_000) | 0;

  // 3. Build start attributes with semantic conventions
  const requestHeaders = nativeHooks.getConfigurationProperty(
    ConfigurationProperty.http_capture_headers_server_request
  );

  const attributes = {
    "operation.id": operationId,
    "http.request.method": req.method || "GET",
    "url.path": req.url || "/",
    "url.scheme": "http",
    "server.address": req.headers.host?.split(":")[0] || "localhost",
    "server.port": parseInt(req.headers.host?.split(":")[1] || "80"),
    "network.protocol.version": req.httpVersion,
    "user_agent.original": req.headers["user-agent"],
  };

  // Add captured headers
  if (Array.isArray(requestHeaders)) {
    for (const headerName of requestHeaders) {
      const value = req.headers[headerName];
      if (value !== undefined) {
        attributes[`http.request.header.${headerName}`] = value;
      }
    }
  }

  // 4. Notify operation start
  nativeHooks.notifyStart(InstrumentKind.HTTP, operationId, attributes);

  // 5. Register completion handlers
  res.once("finish", () => {
    const responseAttrs = buildResponseAttributes(res, operationId);
    nativeHooks.notifyEnd(InstrumentKind.HTTP, operationId, responseAttrs);
  });

  res.once("error", (err: unknown) => {
    const errorAttrs = buildErrorAttributes(res, operationId, err);
    nativeHooks.notifyError(InstrumentKind.HTTP, operationId, errorAttrs);
  });
}
```

### Fetch Client with Header Injection

```typescript
// src/js/internal/telemetry_fetch.ts

export function handleOutgoingFetch(url: string, init: RequestInit) {
  if (!nativeHooks.isEnabledFor(InstrumentKind.Fetch)) {
    return;
  }

  const operationId = (performance.now() * 1_000_000) | 0;

  // 1. Call inject to get distributed tracing headers
  const injections = nativeHooks.notifyInject(InstrumentKind.Fetch, operationId, {
    "operation.id": operationId,
    "url.full": url,
    "http.request.method": init.method || "GET",
  });

  // 2. Merge injected headers into request
  const headers = new Headers(init.headers);
  for (const injection of injections) {
    if (injection && typeof injection === "object") {
      for (const [key, value] of Object.entries(injection)) {
        headers.set(key, String(value));
      }
    }
  }
  init.headers = headers;

  // 3. Build attributes and notify start
  const attributes = buildFetchAttributes(url, init, operationId);
  nativeHooks.notifyStart(InstrumentKind.Fetch, operationId, attributes);

  // Continue with fetch...
}
```

---

## Error Handling

### Defensive Isolation

**Policy**: Errors in nativeHooks must never crash the runtime.

**Implementation**:
```zig
// src/bun.js/telemetry.zig
pub fn notifyOperationStart(self: *Telemetry, kind: InstrumentKind, id: u64, info: JSValue) void {
    const kind_index = @intFromEnum(kind);
    for (self.instrument_table[kind_index].items) |*record| {
        record.invokeStart(self.global, id, info);
    }
}

pub fn invokeStart(self: *InstrumentRecord, global: *JSGlobalObject, id: u64, info: JSValue) void {
    if (!self.on_op_start_fn.isCallable()) return;

    _ = self.on_op_start_fn.callWithGlobalThis(global, &args) catch |err| {
        // Log but don't propagate - operation continues
        std.debug.print("Telemetry: onOperationStart failed: {}\n", .{err});
    };
}
```

**Guarantees**:
- Hook errors logged to stderr
- Request processing continues
- Other instruments still invoked
- No exceptions thrown to caller

---

## Performance Characteristics

### Hot Path Optimization

**When Disabled** (no instruments):
```typescript
if (!nativeHooks.isEnabledFor(kind)) {
  return; // ~5ns overhead, early return before attribute building
}
```

**When Enabled**:
- `isEnabledFor()`: ~5ns (array length check)
- `notifyStart()`: ~100ns × num_instruments
- Attribute building: ~1μs (in TypeScript bridge)
- **Total**: ~1-2μs per operation (target <5% overhead)

### Memory

- Each notify call: Stack-allocated arguments (~128 bytes)
- Configuration properties: Heap-allocated, shared across all operations
- No per-request allocations in Zig layer

---

## Concurrency & Thread Safety

**Threading Model**:
- All nativeHooks calls: Main JavaScript thread
- No locks required (single-threaded execution)
- Atomic ID generation (thread-safe for future multi-threading)

**Invariants**:
- Operation IDs globally unique
- Hook execution serialized per operation
- No race conditions in notify calls

---

## Testing Guidelines

### Unit Tests (test/js/bun/telemetry/)

**Test Coverage**:
- ✅ `isEnabledFor()` returns correct boolean
- ✅ `notifyStart/End/Error/Progress` invoke registered hooks
- ✅ `notifyInject` collects and returns array
- ✅ `getConfigurationProperty` returns correct values
- ✅ `setConfigurationProperty` updates both JS and native storage
- ✅ Hook errors don't crash runtime

**Example Test**:
```typescript
import { test, expect } from "bun:test";

test("notifyStart invokes all registered instruments", () => {
  const calls: number[] = [];

  const id1 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-1",
    version: "1.0.0",
    onOperationStart(id, attrs) {
      calls.push(1);
    },
  });

  const id2 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-2",
    version: "1.0.0",
    onOperationStart(id, attrs) {
      calls.push(2);
    },
  });

  // Call via nativeHooks (simulating bridge layer)
  Bun.telemetry.nativeHooks.notifyStart(InstrumentKind.HTTP, 12345, {
    "operation.id": 12345,
    "http.request.method": "GET",
  });

  expect(calls).toEqual([1, 2]);

  Bun.telemetry.detach(id1);
  Bun.telemetry.detach(id2);
});
```

---

## Security Considerations

### Configuration Security

**Header Capture**:
- Only headers explicitly listed in configuration are captured
- Sensitive headers blocked at semantic convention level
- See [hook-lifecycle.md](./hook-lifecycle.md#header-capture-security) for blocklist

**Header Injection**:
- Instruments can only inject custom headers
- Cannot overwrite standard headers (Host, Content-Length, etc.)
- Merge behavior documented in [header-injection.md](./header-injection.md)

### Isolation

- nativeHooks cannot access instrument internals
- Instruments cannot access each other's data
- Configuration changes don't affect in-flight operations

---

## Internal Implementation Details

### File Locations

**Zig Implementation**:
- `src/bun.js/telemetry.zig` - Main telemetry registry
- `src/bun.js/telemetry_config.zig` - Configuration management
- `src/bun.js/bindings/BunObject.cpp` - C++ bindings for nativeHooks

**TypeScript Bridges**:
- `src/js/internal/telemetry_http.ts` - HTTP server/client bridge
- `src/js/internal/telemetry_fetch.ts` - Fetch client bridge (future)

**Type Definitions**:
- `packages/bun-types/telemetry.d.ts` - Public telemetry API (string literals, no nativeHooks)
- `packages/bun-otel/types.ts` - Internal SDK types (numeric enums, nativeHooks namespace) - NOT exported from package

### Memory Management

**Configuration Properties**:
```zig
// Dual storage for fast access
js_properties: [ConfigurationProperty.COUNT]JSValue,      // Protected from GC
native_properties: [ConfigurationProperty.COUNT]std.ArrayList(bun.String),
```

**Lifecycle**:
1. `setConfigurationProperty()`: Unprotect old → Protect new → Sync native
2. `getConfigurationProperty()`: Return protected JSValue (no copy)
3. `deinit()`: Unprotect all → Free native arrays

---

## Future Extensions

### Planned Additions

- **Batch Notifications**: `notifyBatch(kind, operations[])` for efficiency
- **Filtering**: Per-instrument attribute filtering configuration
- **Sampling**: Built-in sampling at nativeHooks level

### Non-Goals

- Public exposure (remains internal bridge API)
- Async notify methods (synchronous execution only)
- Dynamic property registration (fixed enum)

---

## Backward Compatibility

**Stability**:
- API stable for Bun 1.x series
- New ConfigurationProperty values added over time
- Existing properties never change behavior
- Function signatures may gain optional parameters (backward compatible)

**Deprecation Policy**:
- Deprecated functions kept for 2 minor versions
- Warnings logged when deprecated functions called
- Migration path documented in changelog
