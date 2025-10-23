# Contract: Telemetry Global API (TypeScript Bridge)

**Feature**: OpenTelemetry Support for Bun
**Component**: Global telemetry functions and nativeHooks bridge API
**Scope**: TypeScript-side bridge API and global configuration
**Audience**: TypeScript bridge implementations (src/js/internal/telemetry\_\*.ts) and package authors

**Related**: See `telemetry-context.md` for Zig runtime API (TelemetryContext)

## Overview

Global telemetry API provides:

1. **Global functions**: init(), attach(), detach() for telemetry lifecycle
2. **nativeHooks bridge**: TypeScript → Instrument dispatch layer (INTERNAL)
3. **Configuration**: Header capture/propagation settings

**Architecture** (TypeScript-side only, see `telemetry-context.md` for Zig-side):

```
┌─────────────────────────────────────────────────────┐
│ TypeScript Bridge (src/js/internal/telemetry_*.ts) │
│  - telemetry_http.ts, telemetry_fetch.ts            │
│  - Called by TelemetryContext from Zig              │
│  - Builds semantic convention attributes            │
└──────────────┬──────────────────────────────────────┘
               │ Uses nativeHooks (INTERNAL)
               ▼
┌─────────────────────────────────────────────────────┐
│ Bun.telemetry.nativeHooks (this API - INTERNAL)    │
│  - notifyStart/End/Error/Progress/Inject           │
│  - isEnabledFor, get/setConfigurationProperty      │
└──────────────┬──────────────────────────────────────┘
               │ Dispatches to
               ▼
┌─────────────────────────────────────────────────────┐
│ Registered Instruments (via Bun.telemetry.attach)  │
│  - User-provided onOperation* hooks                 │
└─────────────────────────────────────────────────────┘
```

## Types

**External Namespace**

```ts
// note, custom intentionally omitted, reserved for unknown string.
export type InstrumentKind = "http" | "fetch" | "sql" | "redis" | "s3";
```

**Internal SDK** (bun-otel/types.ts - NOT exported from package):

```typescript
export enum InstrumentKind {
  Custom = 0,
  HTTP = 1,
  Fetch = 2,
  SQL = 3,
  Redis = 4,
  S3 = 5,
}
```

**Zig Definition** (src/telemetry/main.zig):

```zig
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

## Global Functions (Public)

### `Bun.telemetry.init(config: TelemetryConfig): void`

Initialize telemetry system. Called once at application startup.

**Parameters**:

- `config` (object): Initial telemetry configuration

**Throws**: Error if already initialized

### `Bun.telemetry.attach(instrument: Instrument): InstrumentRef`

Register an instrument for telemetry callbacks.

**Parameters**:

- `instrument` (Instrument): Instrument object implementing the Instrument interface (see below)

**Returns**: `InstrumentRef` - Object with instrument ID and Disposable interface

- Contains `id` property for use with `detach()`
- Implements Disposable pattern for automatic cleanup with `using` statement
- Example: `using instrument = Bun.telemetry.attach(...);`

**Throws**: Error if invalid instrument

**Instrument Interface**:

```typescript
export type OpId = number & { readonly __brand: 'OpId' };

export interface Instrument {
  // Instrument kind (used for routing to correct operation hooks)
  readonly kind: InstrumentKind;

  // Lifecycle callbacks (optional) - called by Zig when instrument is attached/detached
  onAttach?(): void;
  onDetach?(): void;

  // Operation callbacks (at least one required)
  onOperationStart?(operationId: OpId, attributes: Record<string, any>): void;
  onOperationProgress?(operationId: OpId, attributes: Record<string, any>): void;
  onOperationEnd?(operationId: OpId, attributes: Record<string, any>): void;
  onOperationError?(operationId: OpId, attributes: Record<string, any>): void;
  onOperationInject?(operationId: OpId, context: Record<string, any>): any;
}
```

**Behavior**:

- When `attach()` is called, the instrument's `onAttach()` callback (if present) is invoked synchronously
- When `detach()` is called, the instrument's `onDetach()` callback (if present) is invoked synchronously before removal
- Lifecycle callbacks allow instruments to initialize/cleanup resources (e.g., start/stop metric collection timers)

### `Bun.telemetry.detach(instrumentRef: InstrumentRef): void`

Unregister an instrument by reference.

**Parameters**:

- `instrumentRef` (InstrumentRef): InstrumentRef object returned from attach()

**Returns**: `void`

**Throws**:

- `RangeError`: If instrumentRef ID was never valid (never returned from attach)
- No error if already detached (idempotent for cleanup)

**Behavior**:

- First call: Detaches instrument and returns normally
- Subsequent calls with same ref: No-op, returns normally (idempotent)
- Invalid ref (never from attach): Throws RangeError

## nativeHooks API (INTERNAL)

**Note**: nativeHooks is INTERNAL API for TypeScript bridges. Not intended for direct use by application code.

**Operation IDs**: All notify\* functions require an operation ID from `nativeHooks.generateId()`. IDs use the OpId type:
- **Zig side**: `pub const OpId = u64` type alias (defined in src/telemetry/main.zig:15)
- **TypeScript side**: `export type OpId = number & { readonly __brand: 'OpId' }` branded type (hook-lifecycle.md:13)
- **Conversion**: Zig OpId (u64) converted to JavaScript number with 53-bit safe precision (up to 2^53-1)
- **Properties**: Monotonic, globally unique, thread-safe

### `Bun.telemetry.nativeHooks.isEnabledFor(kind: InstrumentKind): boolean`

Fast check if any instruments are registered for an operation kind.

**Parameters**:

- `kind` (InstrumentKind): InstrumentKind enum value (0-5)

**Returns**: `boolean`

- `true` if at least one instrument registered for this kind
- `false` otherwise (safe to skip attribute building)

**Performance**:

- O(1) array length check
- ~5ns overhead
- Used at top of every bridge function for early return

**Example**:

```typescript
// packages/bun-otel/src/instruments/BunHttpInstrumentation.ts
export function handleIncomingRequest(
  req: IncomingMessage,
  res: ServerResponse,
) {
  // Early return if no HTTP instruments registered
  if (!nativeHooks.isEnabledFor(InstrumentKind.HTTP)) {
    return;
  }

  // Continue with expensive attribute building...
}
```

---

### `Bun.telemetry.nativeHooks.generateId(): OpId`

Generate a unique operation ID for telemetry events.

**Returns**: `OpId` (branded `number` type)

- Monotonically increasing OpId
- **Zig implementation**: Returns OpId (u64 type alias, see src/telemetry/main.zig:15)
- **TypeScript type**: OpId (branded number, see hook-lifecycle.md:13)
- **Conversion**: Zig OpId (u64) → JavaScript number via IEEE 754 double precision
- **Safe range**: IDs up to 2^53-1 (9007199254740991) maintain exact precision
- **Capacity**: At 1 million operations/second, provides ~285 years of unique IDs
- **Scope**: Globally unique across all operation types

**Performance**:

- Atomic increment operation
- ~2ns overhead
- Thread-safe for future multi-threading

**Example**:

```typescript
// packages/bun-otel/src/instruments/BunHttpInstrumentation.ts
const operationId = nativeHooks.generateId();
const attributes = buildRequestAttributes(req);
nativeHooks.notifyStart(InstrumentKind.HTTP, operationId, attributes);
```

**Note**: JavaScript numbers can safely represent integers up to 2^53-1. Beyond this limit, values will lose precision. This is acceptable as reaching 2^53 operations is extremely unlikely in practice (would take ~285 years at 1M ops/sec).

---

### `Bun.telemetry.nativeHooks.notifyStart(kind: InstrumentKind, id: OpId, attributes: object): void`

Notifies all registered instruments of an operation start.

**Parameters**:

- `kind` (InstrumentKind): InstrumentKind enum value
- `id` (OpId): Unique operation ID from `generateId()`
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
// packages/bun-otel/src/instruments/BunHttpInstrumentation.ts
const operationId = nativeHooks.generateId();
const attributes = buildRequestAttributes(req);

nativeHooks.notifyStart(InstrumentKind.HTTP, operationId, attributes);
```

---

### `Bun.telemetry.nativeHooks.notifyEnd(kind: InstrumentKind, id: OpId, attributes: object): void`

Notifies all registered instruments of an operation completion.

**Parameters**:

- `kind` (InstrumentKind): InstrumentKind enum value
- `id` (OpId): Same operation ID from `notifyStart`
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
  "http.response.status_code": 200,
  "http.response.body.size": 1024,
  "http.response.header.content-type": ["application/json"],
  // ... additional response attributes
}
```

**Example**:

```typescript
// packages/bun-otel/src/instruments/BunHttpInstrumentation.ts
res.once("finish", () => {
  const attributes = buildResponseAttributes(res);
  nativeHooks.notifyEnd(InstrumentKind.HTTP, operationId, attributes);
});
```

---

### `Bun.telemetry.nativeHooks.notifyError(kind: InstrumentKind, id: OpId, attributes: object): void`

Notifies all registered instruments of an operation error.

**Parameters**:

- `kind` (InstrumentKind): InstrumentKind enum value
- `id` (OpId): Same operation ID from `notifyStart`
- `attributes` (object): Error details following semantic conventions

**Returns**: `void`

**Behavior**:

- Should be called instead of (not in addition to) `notifyEnd`
- Error attributes follow OpenTelemetry error semantic conventions

**Attribute Format**:

```typescript
// Example error attributes
{
  "error.type": "Error",
  "error.message": "Connection reset",
  "error.stack": "Error: Connection reset\n  at...",
  // ... additional error context
}
```

**Example**:

```typescript
// packages/bun-otel/src/instruments/BunHttpInstrumentation.ts
res.once("error", (err: unknown) => {
  const attributes = buildErrorAttributes(err);
  nativeHooks.notifyError(InstrumentKind.HTTP, operationId, attributes);
});
```

---

### `Bun.telemetry.nativeHooks.notifyProgress(kind: InstrumentKind, id: OpId, attributes: object): void`

Notifies all registered instruments of intermediate operation progress.

**Parameters**:

- `kind` (InstrumentKind): InstrumentKind enum value
- `id` (OpId): Same operation ID from `notifyStart`
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
    "http.request.body.bytes_received": bytesReceived,
  });
});
```

---

### `Bun.telemetry.nativeHooks.notifyInject(kind: InstrumentKind, id: OpId, data: object): any[]`

Collects header injection values from all registered instruments.

**Parameters**:

- `kind` (InstrumentKind): InstrumentKind enum value
- `id` (OpId): Operation ID
- `data` (object): Context for injection (current headers, URL, etc.)

**Returns**: `any[]`

- Flat array of header values only: `[value1, value2, value3, ...]`
- Values correspond by index to header names from configuration
- Each instrument's `onOperationInject` return value is flattened into the result
- Empty array if no instruments or no injections

**Behavior**:

- Calls `onOperationInject(id, data)` on all registered instruments
- Collects non-null/non-undefined return values (arrays of header values)
- Header names come from configuration (`injectHeaders` from instrument's `attach()` call)
- Values are zipped with configured names using array index
- Used for distributed tracing header injection (W3C Trace Context)

**Design Rationale**: Two-stage injection minimizes memory allocation during hot-path telemetry recording. Configuration (header names) is set once at startup; hooks return only values during each operation.

**Data Format**:

```typescript
// Input data provided to instruments
{
  "url.full": "https://api.example.com/users",
  "http.request.method": "GET",
  // ... other context
}
```

**Return Format**:

```typescript
// Flat array of VALUES only (header names from config)
// Example: If instrument configured injectHeaders: ["traceparent", "tracestate", "baggage"]
// Hook returns values in same order:
[
  "00-abc123-def456-01", // traceparent value
  "vendor=value", // tracestate value
  "key1=value1,key2=value2", // baggage value
];
```

**Example**:

```typescript
// packages/bun-otel/src/instruments/BunHttpInstrumentation.ts

// Step 1: Get configured header names from instrument registration
const injectNames = nativeHooks.getConfigurationProperty(
  ConfigurationProperty.http_propagate_headers_fetch_request,
);

// Step 2: Get header values from instruments
const injectValues = nativeHooks.notifyInject(
  InstrumentKind.Fetch,
  operationId,
  {
    "url.full": url.href,
    "http.request.method": method,
  },
);

// Step 3: Zip names and values together by index
if (Array.isArray(injectNames)) {
  for (let i = 0; i < injectNames.length; i++) {
    const name = injectNames[i];
    const value = injectValues[i];
    if (name && value !== undefined) {
      headers.set(String(name), String(value));
    }
  }
}
```

---

### `Bun.telemetry.nativeHooks.getConfigurationProperty(propertyId: number): any`

Retrieves a configuration property value by its enum ID.

**Parameters**:

- `propertyId` (number): ConfigurationProperty enum value (1-6)

**Returns**: `any` (JSValue)

- The same JSValue that was passed to `setConfigurationProperty`, or computed value
- For header properties: typically `string[]` (array of lowercase header names)
- `undefined` if property not set or invalid ID

**Note**: The Zig implementation (`otel.getConfigurationProperty`) returns a comptime `ConfigurationValue` struct (e.g., `AttributeList` for header properties). This TypeScript API returns the underlying JSValue.

**Configuration Properties**:

```typescript
enum ConfigurationProperty {
  RESERVED = 0, // Always undefined
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
["content-type", "content-length", "user-agent"];
```

**Example**:

```typescript
// src/js/internal/telemetry_http.ts
const requestHeaders = nativeHooks.getConfigurationProperty(
  ConfigurationProperty.http_capture_headers_server_request,
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
TypeError: "Cannot set RESERVED property";
TypeError: "Invalid property ID";
TypeError: "Property must be an array of strings";
Error: "Failed to set configuration property";
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
// packages/bun-otel/src/configuration.ts
import { nativeHooks, ConfigurationProperty } from "../../types";

// Parse from environment variable
const captureHeaders =
  process.env.OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST?.split(
    ",",
  )
    .map(h => h.trim().toLowerCase())
    .filter(Boolean) || [];

// Apply to native layer
nativeHooks.setConfigurationProperty(
  ConfigurationProperty.http_capture_headers_server_request,
  captureHeaders,
);
```

---

## Type Definitions

### InstrumentKind Enum

**Purpose**: Identifies the type of operation being instrumented.

**Zig Definition** (src/telemetry/main.zig):

```zig
pub const InstrumentKind = enum(u8) {
    custom = 0,
    http = 1,      // HTTP server (server.zig)
    fetch = 2,     // HTTP client fetch (fetch.zig)
    sql = 3,       // SQL database operations
    redis = 4,     // Redis operations
    s3 = 5,        // S3 operations

    pub const COUNT = @typeInfo(InstrumentKind).Enum.fields.len;
};
```

**TypeScript Definition** (packages/bun-otel/types.ts):

```typescript
export enum InstrumentKind {
  custom = 0,
  http = 1,
  fetch = 2,
  sql = 3,
  redis = 4,
  s3 = 5,
}
```

**Public API vs Internal Representation**:

The InstrumentKind type has two representations:

1. **Public API** (packages/bun-types/telemetry.d.ts):
   - Uses string literals: `"custom" | "http" | "fetch" | "sql" | "redis" | "s3"`
   - Used in `Bun.telemetry.attach({ type: "http", ... })`
   - Ergonomic for application developers

2. **Internal API** (packages/bun-otel/types.ts, nativeHooks):
   - Uses numeric enum: `InstrumentKind.http = 1`
   - Used by nativeHooks and internal bridges
   - NOT exported from public `bun:telemetry` module

**Conversion**: The Zig bridge layer automatically converts string literals from the public API to numeric enum values for internal use. This decouples internal implementation details (numeric values) from the public API, without compromising performance. String parsing happens only during setup and reflection; numeric enum values enable comptime optimization and O(1) dispatch.

**Usage Note**: Application code uses string literals (`"http"`), while internal instrumentation code (TypeScript bridges) uses the numeric enum (`InstrumentKind.http`). See `bun-telemetry-api.md` for complete public API documentation.

---

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
// packages/bun-otel/src/instruments/BunHttpInstrumentation.ts

export function handleIncomingRequest(
  req: IncomingMessage,
  res: ServerResponse,
) {
  // 1. Early return check
  if (!nativeHooks.isEnabledFor(InstrumentKind.HTTP)) {
    return;
  }

  // 2. Generate operation ID
  const operationId = nativeHooks.generateId();

  // 3. Build start attributes with semantic conventions
  const requestHeaders = nativeHooks.getConfigurationProperty(
    ConfigurationProperty.http_capture_headers_server_request,
  );

  const attributes = {
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
    const responseAttrs = buildResponseAttributes(res);
    nativeHooks.notifyEnd(InstrumentKind.HTTP, operationId, responseAttrs);
  });

  res.once("error", (err: unknown) => {
    const errorAttrs = buildErrorAttributes(err);
    nativeHooks.notifyError(InstrumentKind.HTTP, operationId, errorAttrs);
  });
}
```

### Fetch Client with Header Injection

**See**: `specs/001-opentelemetry-support/contracts/telemetry-http.md` for detailed HTTP header injection implementation.

General pattern (two-stage injection):

```typescript
// packages/bun-otel/src/instruments/BunFetchInstrumentation.ts

export function handleOutgoingFetch(url: string, init: RequestInit) {
  if (!nativeHooks.isEnabledFor(InstrumentKind.Fetch)) {
    return;
  }

  const operationId = nativeHooks.generateId();

  // 1. Get configured header names to inject
  const injectNames = nativeHooks.getConfigurationProperty(
    ConfigurationProperty.http_propagate_headers_fetch_request,
  );

  // 2. Get header values from instruments (returns array of values)
  const injectValues = nativeHooks.notifyInject(
    InstrumentKind.Fetch,
    operationId,
    {
      "url.full": url,
    },
  );

  // 3. Zip header names and values together by index
  if (Array.isArray(injectNames)) {
    for (let i = 0; i < injectNames.length; i++) {
      const headerName = injectNames[i];
      const headerValue = injectValues[i];
      if (headerName && headerValue !== undefined) {
        // Merge into request headers
        // (See telemetry-http.md for header merge behavior)
        init.headers = init.headers || {};
        init.headers[headerName] = headerValue;
      }
    }
  }

  // 4. Build attributes and notify start
  const attributes = buildFetchAttributes(url, init);
  nativeHooks.notifyStart(InstrumentKind.Fetch, operationId, attributes);
}
```

---

## Error Handling

### Defensive Isolation

**Policy**: Errors in nativeHooks must never crash the runtime.

**Implementation**:

```zig
// src/telemetry/main.zig
pub fn notifyOperationStart(self: *Telemetry, kind: InstrumentKind, id: OpId, info: JSValue) void {
    const kind_index = @intFromEnum(kind);
    for (self.instrument_table[kind_index].items) |*record| {
        record.invokeStart(self.global, id, info);
    }
}

pub fn invokeStart(self: *InstrumentRecord, global: *JSGlobalObject, id: OpId, info: JSValue) void {
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

- `src/telemetry/main.zig` - Main telemetry registry
- `src/telemetry/config.zig` - Configuration management
- `src/telemetry/http.zig` - HTTP server telemetry hooks
- `src/telemetry/fetch.zig` - Fetch client telemetry hooks
- `src/bun.js/bindings/BunObject.cpp` - C++ bindings for nativeHooks

**TypeScript Bridges**:

- `src/js/internal/telemetry_http.ts` - HTTP server/client bridge (uses nativeHooks internally)
- `src/js/internal/telemetry_fetch.ts` - Fetch client bridge (future)

**Type Definitions and Module Structure**:

The telemetry API has a dual-layer type structure:

1. **Public API** (`bun:telemetry` module):
   - Location: `packages/bun-types/telemetry.d.ts`
   - Exports: `Bun.telemetry.init()`, `attach()`, `detach()` only
   - Does NOT export: `nativeHooks`, `InstrumentKind`, `ConfigurationProperty`
   - Used by: Application developers using bun-otel package

2. **Internal API** (packages/bun-otel/types.ts):
   - Location: `packages/bun-otel/types.ts`
   - Exports: `nativeHooks`, `InstrumentKind`, `ConfigurationProperty` enums
   - Accessible via: `import { nativeHooks } from "../../types"` within bun-otel package
   - Used by: Internal TypeScript bridges and bun-otel instrumentation implementations
   - NOT exported from the bun-otel package to prevent external usage

This separation ensures nativeHooks remains an internal implementation detail while providing a clean public API.

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
