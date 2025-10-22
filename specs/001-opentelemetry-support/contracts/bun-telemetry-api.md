# Contract: Bun.telemetry API

**Component**: Native Telemetry API (Zig layer)
**Scope**: Core attach/detach instrumentation API
**Design Rationale**: [ADR-001](./decisions/ADR-001-telemetry-api-design.md)

**Related Contracts**:

- [hook-lifecycle.md](./hook-lifecycle.md) - Hook specifications and attributes
- [header-injection.md](./header-injection.md) - Header injection for distributed tracing

---

## API Surface

### `Bun.telemetry.attach(instrument: NativeInstrument): InstrumentRef`

Registers an instrumentation for specific operation types.

**Parameters**:

```typescript
type RequestId = number | unique Symbol;
type InstrumentRef = { id: number } & Disposable; // deregister function
type InstrumentKind = "custom" | "http" | "fetch" | "sql" | "redis" | "s3";

interface NativeInstrument {
  type: InstrumentKind; // Required: Operation category ("http", "fetch", etc.)
  name: string; // Required: Instrumentation name
  version: string; // Required: Instrumentation version

  // Attribute capture configuration (optional)
  captureAttributes?: {
    requestHeaders?: string[]; // HTTP request headers to capture
    responseHeaders?: string[]; // HTTP response headers to capture
  };

  // Lifecycle hooks (at least one required)
  // All hooks receive semantic convention attributes (Record<string, any>)
  onOperationStart?: (id: RequestId, attributes: Record<string, any>) => void;
  onOperationProgress?: (
    id: RequestId,
    attributes: Record<string, any>,
  ) => void;
  onOperationEnd?: (id: RequestId, attributes: Record<string, any>) => void;
  onOperationError?: (id: RequestId, attributes: Record<string, any>) => void;
  onOperationInject?: (
    id: RequestId,
    data?: unknown,
  ) => Record<string, string> | void;

  // Header injection configuration (optional)
  // Declares which headers this instrument will inject
  // See header-injection.md for merge behavior and security constraints
  injectHeaders?: {
    request?: string[]; // Headers for outgoing fetch requests
    response?: string[]; // Headers for HTTP server responses
  };
}
```

**Returns**: `InstrumentRef`

- Unique instrument ID (positive integer)
- Use this ID for `detach()` to unregister

**Throws**:

```typescript
TypeError: "instrument must be an object";
TypeError: "instrument.type must be a valid operation kind string";
TypeError: "instrument.name must be a non-empty string";
TypeError: "instrument.version must be a non-empty string";
TypeError: "At least one hook function must be provided";
TypeError: "onOperationStart must be a function";
// ... similar for other hooks
```

**Validation**:

- MUST: Valid InstrumentKind string ("custom" | "http" | "fetch" | "sql" | "redis" | "s3")
- MUST: Non-empty `name` string (max 256 chars)
- MUST: Non-empty `version` string (semver format)
- MUST: Provide at least one hook function
- MUST NOT: Use async functions as hooks
- MUST: Lowercase strings in `captureAttributes` arrays (max 50)
- MUST NOT: Include blocked headers (authorization, cookie, etc.)

**Side Effects**:

- Instrument registered in global `Telemetry` singleton
- JSValue references protected (prevents GC)
- Future operations of matching `type` will invoke hooks

**Performance**:

- O(1) registration time
- ~160 bytes memory allocation per instrument

**Example**:

```typescript
const instrumentId = Bun.telemetry.attach({
  type: "http",
  name: "@opentelemetry/instrumentation-http",
  version: "0.1.0",

  captureAttributes: {
    requestHeaders: ["content-type", "x-request-id"],
    responseHeaders: ["content-type"],
  },

  onOperationStart(id, attributes) {
    // attributes follow OpenTelemetry semantic conventions
    console.log(
      `HTTP ${attributes["http.request.method"]} ${attributes["url.path"]} started`,
    );
  },

  onOperationEnd(id, attributes) {
    console.log(
      `HTTP completed with status ${attributes["http.response.status_code"]}`,
    );
  },
});

console.log(`Registered instrument: ${instrumentId}`);
// For detailed attribute specifications, see contracts/hook-lifecycle.md
```

---

### `Bun.telemetry.detach(instrumentId: InstrumentRef): void`

Unregisters a previously attached instrumentation.

**Parameters**:

- `instrumentId` (InstrumentRef): ID returned from `attach()`

**Returns**: `void`

**Throws**:

```typescript
TypeError: "instrumentId must be a InstrumentRef";
RangeError: "Invalid instrument ID: ${instrumentId}";
```

**Validation Rules**:

1. `instrumentId` must be a value returned from `Bun.telemetry.attach`
2. `instrumentId` must correspond to a currently registered instrument
3. Detaching same ID more than once has no effect

**Side Effects**:

- Instrument removed from global registry
- JSValue references unprotected (allows GC)
- Future operations will NOT invoke this instrument's hooks
- In-flight operations (already started) continue to completion but may or may not trigger this instrument
- Operations started _strictly after_ `detach()` are never passed to the instrumentation.

**Performance**:

- O(n) where n = number of instruments for that kind (typically <10)
- All memory freed immediately

**Example**:

```typescript
const id = Bun.telemetry.attach({
  /* ... */
});

// Later: unregister
Bun.telemetry.detach(id);

// Error: already detached
Bun.telemetry.detach(id); // Throws RangeError
```

---

## Type Definitions

### InstrumentKind Type

**Public API** (packages/bun-types/telemetry.d.ts):

```typescript
export type InstrumentKind =
  | "custom"
  | "http"
  | "fetch"
  | "sql"
  | "redis"
  | "s3";
```

**String Literal Meanings**:

- `"custom"` - User-defined operations
- `"http"` - HTTP server (Bun.serve, http.createServer)
- `"fetch"` - Fetch client operations
- `"sql"` - Database operations
- `"redis"` - Redis operations
- `"s3"` - S3 operations

**Internal SDK** (bun-otel/types.ts - NOT exported):

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

**Design Rationale**: See ADR-003. Public API uses ergonomic string literals; internal SDK uses numeric enums for type-safe Zig FFI.

**Extensibility**:

- New kinds added in future Bun versions
- Backward compatible (old code ignores new kinds)
- Values never reused (monotonic)

---

## Error Handling

**Hook Errors**:

- MUST: Log exceptions to stderr with context
- MUST: Continue request processing
- MUST: Invoke remaining instruments
- MUST NOT: Crash runtime
- MUST NOT: Silently swallow errors

**Error Format**: `[Telemetry] Error in {hook} ({name} v{version}): {message}`

---

## Concurrency & Thread Safety

- MUST: Attach/detach on main JavaScript thread only
- MAY: Invoke hooks on different request threads
- MUST: Use atomic operations for ID generation
- MUST NOT: Reuse IDs (globally unique)
- MUST: Serialize hook execution per request

---

## Memory Management

**JSValue Protection**:

- MUST: protect() JSValues on attach
- MUST: unprotect() JSValues on detach
- MUST: Match every protect() with unprotect()
- MUST: Use defer for exception safety

**Implementation**: See `telemetry.zig` protect/unprotect calls

---

## Performance Characteristics

### When Disabled (no instruments)

- `nativeHooks.isEnabledFor()`: ~5ns per check
- Early return before attribute building
- **Target**: <0.1% overhead

### When Enabled (instruments attached)

- Instrument lookup: O(k) where k = instruments for kind
- Hook call overhead: ~100ns per hook
- Attribute building: ~1μs per HTTP request
- **Target**: <5% overhead

### Memory per Instrument

- InstrumentRecord: ~64 bytes
- Protected JSValues: ~96 bytes (6 pointers × 16 bytes)
- **Total**: ~160 bytes

---

## Integration Points

**HTTP Server**: `src/bun.js/api/server.zig`

- MUST: Check `nativeHooks.isEnabledFor(.http)` before processing
- MUST: Generate unique request ID
- MUST: Invoke `onOperationStart` on request arrival
- MUST: Invoke `onOperationEnd` on response completion

**Fetch Client**: `src/bun.js/webcore/fetch.zig`

- MUST: Check `nativeHooks.isEnabledFor(.fetch)` before processing
- MUST: Call `onOperationInject` for header injection
- MUST: Merge returned headers into request
- MUST: Invoke lifecycle hooks in order

---

## Testing Contract

**Location**: `test/js/bun/telemetry/`

**Requirements**:

- MUST: Test native API surface only
- MUST NOT: Import `@opentelemetry/*` packages
- MUST: Verify hook invocation with correct attributes
- MUST: Validate error handling behaviors
- MUST: Clean up instruments after each test

---

## Backward Compatibility

- MUST: Keep API stable in Bun 1.x series
- MAY: Add new InstrumentKind values
- MUST NOT: Change existing kind behaviors
- MAY: Add optional fields to hook signatures
- SHOULD: Use attach/detach instead of deprecated configure()

---

## Security Considerations

**Hook Isolation**:

- MUST NOT: Access other instruments' data
- MUST NOT: Modify request processing
- MUST NOT: Prevent request completion

**Header Capture**:

- MUST: Use allowlist model (deny-by-default)
- MUST NOT: Capture sensitive headers (authorization, cookie, api-key, etc.)
- MUST: Respect `captureAttributes` configuration
- See: [hook-lifecycle.md](./hook-lifecycle.md#header-capture-security) for blocklist

**Resource Limits**:

- Memory: ~160 bytes per instrument
- Headers: Max 50 per capture list
- Execution: Synchronous only (no DOS via async)

---

## Future Extensions

**Planned**:

- `listInstruments()`: Introspection API
- `getActiveSpan()`: Manual instrumentation
- New kinds: WebSocket, DNS, FileSystem

**Non-Goals**:

- Async hooks (performance impact)
- Inter-instrument communication (coupling)
- Dynamic hook registration (complexity)
