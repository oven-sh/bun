# Contract: Bun.telemetry API

**Feature**: OpenTelemetry Support for Bun
**Component**: Native Telemetry API (Zig layer)
**Scope**: Core attach/detach instrumentation API
**Audience**: TypeScript instrumentation authors (packages/bun-otel)

**Related Contracts**:
- [hook-lifecycle.md](./hook-lifecycle.md) - Detailed hook specifications, attribute formats, corner cases

---

## API Surface

### `Bun.telemetry.attach(instrument: NativeInstrument): number`

Registers an instrumentation for specific operation types.

**Parameters**:
```typescript
enum InstrumentKind {
  Custom = 0,
  HTTP = 1,
  Fetch = 2,
  SQL = 3,
  Redis = 4,
  S3 = 5,
}

interface NativeInstrument {
  type: InstrumentKind;           // Required: Operation category
  name: string;                   // Required: Instrumentation name
  version: string;                // Required: Instrumentation version

  // Attribute capture configuration (optional)
  captureAttributes?: {
    requestHeaders?: string[];    // HTTP request headers to capture
    responseHeaders?: string[];   // HTTP response headers to capture
  };

  // Lifecycle hooks (at least one required)
  // All hooks receive semantic convention attributes (Record<string, any>)
  onOperationStart?: (id: number, attributes: Record<string, any>) => void;
  onOperationProgress?: (id: number, attributes: Record<string, any>) => void;
  onOperationEnd?: (id: number, attributes: Record<string, any>) => void;
  onOperationError?: (id: number, attributes: Record<string, any>) => void;
  onOperationInject?: (id: number, data?: unknown) => Record<string, string> | void;
}
```

**Returns**: `number`
- Unique instrument ID (positive integer)
- Use this ID for `detach()` to unregister

**Throws**:
```typescript
TypeError: "instrument must be an object"
TypeError: "instrument.type must be a valid InstrumentKind"
TypeError: "instrument.name must be a non-empty string"
TypeError: "instrument.version must be a non-empty string"
TypeError: "At least one hook function must be provided"
TypeError: "onOperationStart must be a function"
// ... similar for other hooks
```

**Validation Rules**:
1. `type` must be valid InstrumentKind enum value (0-5)
2. `name` must be non-empty string (max 256 chars)
3. `version` must be non-empty string following semver format
4. At least one hook function must be provided
5. All provided hooks must be callable functions
6. Hooks must not be async functions (synchronous execution only)
7. `captureAttributes.requestHeaders` must be array of lowercase strings (max 50)
8. `captureAttributes.responseHeaders` must be array of lowercase strings (max 50)
9. Blocked headers (authorization, cookie, etc.) rejected at attach time

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
  type: InstrumentKind.HTTP,
  name: "@opentelemetry/instrumentation-http",
  version: "0.1.0",

  captureAttributes: {
    requestHeaders: ["content-type", "x-request-id"],
    responseHeaders: ["content-type"],
  },

  onOperationStart(id, attributes) {
    // attributes follow OpenTelemetry semantic conventions
    console.log(`HTTP ${attributes["http.request.method"]} ${attributes["url.path"]} started`);
  },

  onOperationEnd(id, attributes) {
    console.log(`HTTP completed with status ${attributes["http.response.status_code"]}`);
  },
});

console.log(`Registered instrument: ${instrumentId}`);
// For detailed attribute specifications, see contracts/hook-lifecycle.md
```

---

### `Bun.telemetry.detach(instrumentId: number): void`

Unregisters a previously attached instrumentation.

**Parameters**:
- `instrumentId` (number): ID returned from `attach()`

**Returns**: `void`

**Throws**:
```typescript
TypeError: "instrumentId must be a number"
RangeError: "Invalid instrument ID: ${instrumentId}"
```

**Validation Rules**:
1. `instrumentId` must be a positive integer
2. `instrumentId` must correspond to a currently registered instrument
3. Detaching same ID twice throws RangeError

**Side Effects**:
- Instrument removed from global registry
- JSValue references unprotected (allows GC)
- Future operations will NOT invoke this instrument's hooks
- In-flight operations (already started) continue to completion

**Performance**:
- O(n) where n = number of instruments for that kind (typically <10)
- All memory freed immediately

**Example**:
```typescript
const id = Bun.telemetry.attach({ /* ... */ });

// Later: unregister
Bun.telemetry.detach(id);

// Error: already detached
Bun.telemetry.detach(id); // Throws RangeError
```

---

### `Bun.telemetry.isEnabledFor(kind: InstrumentKind): boolean`

Checks if any instruments are registered for a specific operation type.

**Parameters**:
- `kind` (InstrumentKind): Operation category to check

**Returns**: `boolean`
- `true` if at least one instrument registered for `kind`
- `false` otherwise

**Throws**: Never (returns `false` for invalid `kind`)

**Performance**:
- O(1) check (array length lookup)
- ~5ns overhead when disabled
- Used internally for early returns

**Example**:
```typescript
if (Bun.telemetry.isEnabledFor(InstrumentKind.HTTP)) {
  console.log("HTTP instrumentation active");
}
```

---

## Type Definitions

### InstrumentKind Enum

**Zig Definition**:
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

**TypeScript Definition**:
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

**Extensibility**:
- New kinds added in future Bun versions
- Backward compatible (old code ignores new kinds)
- Values never reused (monotonic)

---

## Error Handling

### Instrumentation Hook Errors

**Policy**: Defensive isolation - errors in hooks must not crash Bun runtime

**Behavior**:
```zig
// Zig wrapper around hook invocation
fn callHook(fn: JSValue, args: []const JSValue) void {
    const result = fn.call(global, args);
    if (result.isError()) {
        // Log error but continue processing
        global.throwError("Instrumentation hook threw error", result);
        // Operation continues normally
    }
}
```

**User-Facing Behavior**:
- Exceptions in hooks logged to stderr
- Request processing continues
- Other instruments still invoked
- No crash, no silent failure

**Example**:
```typescript
Bun.telemetry.attach({
  type: InstrumentKind.HTTP,
  name: "buggy-instrument",
  version: "1.0.0",

  onOperationStart(id, attributes) {
    throw new Error("Oops!"); // Logged, request continues
  },
});

// Server still works, error logged:
// [Telemetry] Error in onOperationStart (buggy-instrument v1.0.0): Oops!
```

---

## Concurrency & Thread Safety

**Threading Model**:
- Attach/detach: Main JavaScript thread only
- Hook invocation: Request thread (may differ per request)
- No locks required (single-threaded JS execution)

**Atomic Operations**:
```zig
// ID generation is thread-safe
next_instrument_id: std.atomic.Value(u32)
next_request_id: std.atomic.Value(u64)
```

**Invariants**:
- IDs globally unique (never reused)
- No race conditions in registration
- Hook execution serialized per request

---

## Memory Management

### Protected JSValues

**Problem**: JavaScript objects must not be GC'd while Zig holds references

**Solution**: Reference counting with protect/unprotect
```zig
// On attach
instrument_obj.protect();         // Increment ref count
on_op_start_fn.protect();
on_op_end_fn.protect();
// ...

// On detach
instrument_obj.unprotect();       // Decrement ref count
on_op_start_fn.unprotect();
on_op_end_fn.unprotect();
```

**Invariants**:
- Every `protect()` has matching `unprotect()`
- Detach always cleans up all protected values
- Exception safety via Zig `defer`

---

## Performance Characteristics

### When Disabled (no instruments)
- `isEnabledFor()`: ~5ns per check
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

### Where Hooks Are Called

**HTTP Server** (`src/bun.js/api/server.zig`):
```zig
// Request start
if (Telemetry.isEnabledFor(.http)) {
    const req_id = Telemetry.nextRequestId();
    const info = buildHttpInfo(request);
    Telemetry.invokeStart(.http, req_id, info);
}

// Request end
if (Telemetry.isEnabledFor(.http)) {
    const result = buildHttpResult(response);
    Telemetry.invokeEnd(.http, req_id, result);
}
```

**Fetch Client** (`src/bun.js/webcore/fetch.zig`):
```zig
// Before fetch
if (Telemetry.isEnabledFor(.fetch)) {
    const req_id = Telemetry.nextRequestId();
    const info = buildFetchInfo(request);

    // Get headers to inject
    const inject_data = Telemetry.invokeInject(.fetch, req_id);
    if (inject_data.isObject()) {
        request.headers.merge(inject_data);
    }

    Telemetry.invokeStart(.fetch, req_id, info);
}
```

---

## Testing Contract

### Core Tests (test/js/bun/telemetry/)

**Rules**:
- Test ONLY native API surface
- NO `@opentelemetry/*` imports
- Verify hooks called with correct data
- Validate error handling

**Example**:
```typescript
import { test, expect } from "bun:test";

test("attach registers instrument and returns ID", () => {
  const id = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-instrument",
    version: "1.0.0",
    onOperationStart: () => {},
  });

  expect(typeof id).toBe("number");
  expect(id).toBeGreaterThan(0);

  Bun.telemetry.detach(id); // cleanup
});

test("detach removes instrument", () => {
  const id = Bun.telemetry.attach({ /* ... */ });

  Bun.telemetry.detach(id);

  // Second detach should throw
  expect(() => Bun.telemetry.detach(id)).toThrow(RangeError);
});
```

---

## Backward Compatibility

**Versioning Strategy**:
- API stable in Bun 1.x series
- New InstrumentKind values added over time
- Existing kinds never change behavior
- Hook signatures may gain optional fields (backward compatible)

**Migration from configure() API** (deprecated):
```typescript
// Old (deprecated):
Bun.telemetry.configure({ /* ... */ });

// New (1.0+):
const id = Bun.telemetry.attach({ /* ... */ });
// Remember to call detach(id) when done
```

---

## Security Considerations

### Hook Isolation
- Hooks cannot access other instruments' data
- Hooks cannot modify request processing
- Hooks cannot prevent request completion

### Header Capture
- Only allowlisted headers captured (deny-by-default security model)
- Sensitive headers always blocked (authorization, cookie, api-key, session tokens, etc.)
- Complete blocklist documented in [hook-lifecycle.md](./hook-lifecycle.md#header-capture-security)
- Configurable via `captureAttributes` in NativeInstrument interface

### Resource Limits
- No hard limit on instrument count (trust model)
- Bounded memory per instrument (~160 bytes)
- No DOS vector (synchronous execution)

---

## Future Extensions

### Planned Additions
- `Bun.telemetry.listInstruments(): Array<{id, name, kind}>` - introspection
- `Bun.telemetry.getActiveSpan(): Span | null` - manual instrumentation
- New InstrumentKind values: `WebSocket`, `DNS`, `FileSystem`

### Non-Goals
- Async hooks (performance impact)
- Inter-instrument communication (coupling)
- Dynamic hook registration mid-operation (complexity)
