# Contract: Bun.telemetry API

**Component**: Public Telemetry API
**Scope**: attach/detach instrumentation for application developers
**Audience**: Application developers using Bun's native telemetry

**Related Documentation**:

- [hook-lifecycle.md](./hook-lifecycle.md) - Hook specifications and semantic convention attributes
- [header-injection.md](./header-injection.md) - Header injection for distributed tracing

---

## API Surface

### `Bun.telemetry.attach(instrument: NativeInstrument): InstrumentRef`

Registers an instrumentation for specific operation types.

**Parameters**:

```typescript
// Internal API type - uses branded number for type safety
export type OpId = number & { readonly __brand: "OpId" };
type InstrumentRef = { id: number } & Disposable; // deregister function
type InstrumentKind = "custom" | "http" | "fetch" | "sql" | "redis" | "s3";

interface NativeInstrument {
  type: InstrumentKind; // Required: Operation category ("http", "fetch", etc.)
  name: string; // Required: Instrumentation name
  version: string; // Required: Instrumentation version

  // Attribute capture configuration (optional)
  // Controls which headers are READ from incoming requests/responses
  // See telemetry-http.md for the difference between captureAttributes (READ) and injectHeaders (WRITE)
  captureAttributes?: {
    requestHeaders?: string[]; // HTTP request headers to capture
    responseHeaders?: string[]; // HTTP response headers to capture
  };

  // Header injection configuration (optional)
  // Controls which headers are WRITTEN to outgoing requests/responses for distributed tracing
  // See telemetry-http.md for the difference between captureAttributes (READ) and injectHeaders (WRITE)
  injectHeaders?: {
    request?: string[]; // Headers for outgoing fetch requests
    response?: string[]; // Headers for HTTP server responses
  };

  onAttach?: () => void;
  onDetach?: () => void;

  // Lifecycle hooks (at least one required)
  // All hooks receive semantic convention attributes (Record<string, any>)
  onOperationStart?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationProgress?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationEnd?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationError?: (id: OpId, attributes: Record<string, any>) => void;
  onOperationInject?: (id: OpId, data?: unknown) => any; // Return value is instrument-specific (e.g., string[] for HTTP header values)
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

**Behavior**:

- Instrument is registered globally for the specified operation type
- Future operations of matching `type` will invoke the registered hooks
- Memory overhead: ~160 bytes per instrument

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
2. Throws `RangeError` if `instrumentId` was never valid (never returned from attach)
3. Detaching same ID more than once has no effect (idempotent - no error thrown, returns normally)

**Behavior**:

- Instrument is removed from global registry
- Future operations will NOT invoke this instrument's hooks
- In-flight operations (already started) may or may not trigger this instrument
- Operations started _strictly after_ `detach()` completes will never invoke this instrument
- All memory associated with the instrument is freed

**Example**:

```typescript
const instrumentRef = Bun.telemetry.attach({
  /* ... */
});

// Later: unregister
Bun.telemetry.detach(instrumentRef);

// Idempotent: no error on second call
Bun.telemetry.detach(instrumentRef); // No-op, returns normally

// Only throws if ID was never valid
const fakeRef = { id: 99999 };
Bun.telemetry.detach(fakeRef); // Throws RangeError

// Modern usage with disposable pattern
{
  using instrument = Bun.telemetry.attach({
    /* ... */
  });
  // Automatically detached when leaving scope
}
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

**Operation Types**:

- `"custom"` - User-defined operations
- `"http"` - HTTP server (Bun.serve, http.createServer)
- `"fetch"` - Fetch client (fetch, Request, Response)
- `"sql"` - Database operations (future)
- `"redis"` - Redis operations (future)
- `"s3"` - S3 operations (future)

**Extensibility**:

- New kinds added in future Bun versions
- Backward compatible (old code ignores new kinds)
- Values never reused (monotonic)

**Internal Representation**:

The public API uses string literals for ergonomics. Internally, the Bun runtime and nativeHooks API use a numeric enum for performance. See [telemetry-global.md](./telemetry-global.md#instrumentkind-enum) for the internal numeric representation used by nativeHooks and the Zig bridge layer. Application code should always use the string literal form shown above.

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

## Performance Characteristics

**Overhead When No Instruments Attached**:

- Negligible (<0.1% impact on request throughput)
- Early detection allows operations to skip instrumentation entirely

**Overhead When Instruments Active**:

- ~100ns per hook invocation
- ~1μs attribute building per operation
- Target: <5% overhead on typical HTTP workloads

**Memory Usage**:

- ~160 bytes per registered instrument
- No per-request allocations

---

## Thread Safety

- `attach()` and `detach()` must be called from the main JavaScript thread
- Hook functions are invoked synchronously on the operation thread
- Operation IDs are globally unique and never reused
- Hook execution is serialized per operation (no concurrent calls for same operation)

---

## Backward Compatibility

- API is stable for Bun 1.x series
- New InstrumentKind values may be added in future versions
- Existing kind behaviors will not change
- Optional fields may be added to hook signatures (backward compatible)

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
