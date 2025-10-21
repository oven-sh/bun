# Data Model: OpenTelemetry Support for Bun

**Date**: 2025-10-20
**Feature**: OpenTelemetry Traces, Metrics, and Logs
**Branch**: `001-opentelemetry-support`

## Overview

This document defines the data structures and lifecycle models for Bun's telemetry system. Since this is a refactor of existing working code, the model captures both current (configure API) and target (attach/detach API) states.

## Core Entities

### 1. InstrumentKind (Enum)

**Purpose**: Categorizes operation types for routing telemetry data to appropriate handlers

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

**Lifecycle**: Compile-time constant

### 2. InstrumentRecord (Zig Struct)

**Purpose**: Stores registered instrumentation with cached function pointers for performance

**Structure**:
```zig
pub const InstrumentRecord = struct {
    id: u32,                              // Unique instrument ID
    kind: InstrumentKind,                 // Operation category
    native_instrument_object: JSValue,    // Full JS object (protected)

    // Cached function pointers (validated on attach)
    on_op_start_fn: JSValue,
    on_op_progress_fn: JSValue,
    on_op_end_fn: JSValue,
    on_op_error_fn: JSValue,
    on_op_inject_fn: JSValue,
};
```

**Lifecycle**:
1. **Creation**: `InstrumentRecord.init()` during `Bun.telemetry.attach()`
   - Validates function pointers exist and are callable
   - Protects JSValue references (prevents garbage collection)
2. **Usage**: Functions called during operation lifecycle
3. **Destruction**: `InstrumentRecord.dispose()` during `Bun.telemetry.detach()`
   - Unprotects all JSValue references

**Invariants**:
- ID must be unique across all instruments
- Function pointers validated before storage (only callable functions stored)
- Protected JSValues must be unprotected on dispose

### 3. Telemetry (Zig Singleton)

**Purpose**: Global registry managing all registered instrumentations

**Structure**:
```zig
pub const Telemetry = struct {
    // Fixed-size array indexed by InstrumentKind
    instrument_table: [InstrumentKind.COUNT]std.ArrayList(InstrumentRecord),

    // ID generation (atomic for thread safety)
    next_instrument_id: std.atomic.Value(u32),
    next_request_id: std.atomic.Value(u64),

    allocator: std.mem.Allocator,
    global: *JSGlobalObject,
};
```

**Lifecycle**:
1. **Initialization**: `Telemetry.init()` at Bun startup
2. **Registration**: `attach()` adds InstrumentRecords to appropriate kind slot
3. **Deregistration**: `detach()` removes and disposes InstrumentRecords
4. **Cleanup**: `Telemetry.deinit()` at Bun shutdown

**Invariants**:
- instrument_table[kind] contains only instruments of that kind
- IDs never reused (monotonic counter)
- Request IDs unique per request

### 4. NativeInstrument (TypeScript Interface)

**Purpose**: User-facing API for registering instrumentations

**Structure**:
```typescript
export interface NativeInstrument {
  type: InstrumentKind;
  name: string;
  version: string;

  // Lifecycle hooks (all optional)
  onOperationStart?: (id: number, info: any) => void;
  onOperationProgress?: (id: number, attributes: any) => void;
  onOperationEnd?: (id: number, result: any) => void;
  onOperationError?: (id: number, error: any) => void;
  onOperationInject?: (id: number, data?: unknown) => unknown;

  // Internal state (instrumentation can store private data)
  _internalApi?: object | null;
}
```

**Lifecycle**:
1. **Creation**: User creates object implementing this interface
2. **Registration**: Passed to `Bun.telemetry.attach()` → creates InstrumentRecord
3. **Invocation**: Hooks called during operation lifecycle
4. **Deregistration**: `Bun.telemetry.detach(id)` → disposes InstrumentRecord

**Invariants**:
- At least one hook function must be provided
- Hooks must not throw (wrapped in try/catch by Zig layer)
- Hooks execute synchronously (no async/await)

### 5. AttributeMap (Zig Struct - MVP Implementation)

**Purpose**: Wrapper around JSValue providing a consistent API for attribute access in native code while maintaining plain JavaScript object semantics at the API boundary

**MVP Design Philosophy**:
- This is a **correctness-focused implementation** optimized for development velocity
- Full optimization (C++ AttributeMap with perfect hash) deferred to future story
- Simulates `fastSet`/`fastGet` pattern internally without code generation
- TypeScript API always deals with plain JavaScript objects
- Only Zig code sees the fastSet/fastGet methods

**Structure**:
```zig
pub const AttributeMap = struct {
    // Internal storage: plain JSValue object
    value: JSValue,
    global: *JSGlobalObject,

    // Simulated fast accessors for directly used attributes
    // (internal string lookups, no GPERF codegen in MVP)
    pub fn fastSet(self: *AttributeMap, key: AttributeKey, val: JSValue) void {
        // MVP: Internally does string lookup
        const key_str = attributeKeyToString(key);
        self.value.put(self.global, key_str, val);
    }

    pub fn fastGet(self: *AttributeMap, key: AttributeKey) JSValue {
        // MVP: Internally does string lookup
        const key_str = attributeKeyToString(key);
        return self.value.get(self.global, key_str);
    }

    // Returns plain JavaScript object (no conversion needed in MVP)
    pub fn toJS(self: *AttributeMap) JSValue {
        return self.value;  // Direct return in MVP
    }
};

// Enum for directly used semantic convention attributes
pub const AttributeKey = enum(u8) {
    http_request_method,
    http_response_status_code,
    url_path,
    url_query,
    // ... only attributes directly accessed by Bun core
    // Custom attributes still use plain object access
};

fn attributeKeyToString(key: AttributeKey) []const u8 {
    return switch (key) {
        .http_request_method => "http.request.method",
        .http_response_status_code => "http.response.status_code",
        .url_path => "url.path",
        .url_query => "url.query",
        // ...
    };
}
```

**Key Characteristics**:
1. **Plain Object Semantics**: `toJS()` returns the underlying JSValue directly
2. **Internal Optimization Stub**: `fastSet`/`fastGet` simulate optimization pattern without codegen
3. **Limited Enum**: Only attributes **directly used by Bun core** have enum entries
4. **String Fallback**: Custom/unused attributes use standard JSValue.put/get
5. **Zero API Change Commitment**: When C++ optimization lands, Zig call sites unchanged

**API Boundary Clarity**:
```typescript
// TypeScript layer (packages/bun-otel): ALWAYS sees plain objects
onOperationStart(id: number, info: { method: string; url: string; ... }) {
  const attributes = {
    "http.request.method": info.method,
    "url.path": parseUrl(info.url).pathname,
    // ... standard JavaScript object manipulation
  };
  span.setAttributes(attributes);
}
```

```zig
// Zig layer (src/bun.js/telemetry_http.zig): Sees fastSet/fastGet
pub fn buildHttpInfo(request: *Request) AttributeMap {
    var attrs = AttributeMap.init(global);
    attrs.fastSet(.http_request_method, request.method.toJS());
    attrs.fastSet(.url_path, request.url.path.toJS());
    // Custom headers still use: attrs.value.put(global, "custom.header", val);
    return attrs;
}
```

**Lifecycle**:
1. **Creation**: `AttributeMap.init(global)` wraps a new JSValue object
2. **Population**: `fastSet()` for known keys, direct JSValue access for custom
3. **Handoff**: `toJS()` returns to TypeScript as plain object
4. **No Cleanup Needed**: JSValue garbage collected normally

**Invariants**:
- `value` must be a valid JavaScript object
- `fastSet`/`fastGet` only called with enum values defined in AttributeKey
- Custom attributes bypass enum, use value.put/get directly
- No performance regression vs. plain JSValue objects (MVP)

**Future Optimization Path**:
See `specs/001-opentelemetry-support/attributes-api-research.md` for full C++ implementation design:
- Native `AttributeMap` C++ class replacing JSValue wrapper
- GPERF-generated perfect hash for O(1) semantic convention lookups
- Numeric enum values 0-254 stored in fixed array (first 255 slots)
- Hybrid storage: array for semantic conventions, HashMap for custom attributes
- Expected 10x performance improvement for attribute-heavy workloads
- **Implementation deferred to separate story** to maintain focus on correctness

## Operation Lifecycle Model

### HTTP Request Lifecycle

**Phases**:
```
1. onOperationStart(id, info)
   ├─ info.method: string
   ├─ info.url: string
   ├─ info.headers: object (if configured)
   └─ info.timestamp: number

2. [Optional] onOperationProgress(id, attributes)
   ├─ attributes.phase: "response_start"
   ├─ attributes.status_code: number
   └─ ... (custom attributes)

3a. onOperationEnd(id, result) [success path]
   ├─ result.status_code: number
   ├─ result.content_length: number
   └─ result.headers: object (if captured)

3b. onOperationError(id, error) [error path]
   ├─ error.error_type: string
   ├─ error.error_message: string
   └─ error.stack_trace?: string

[Parallel] onOperationInject(id, data?) → headers object
   └─ Returns: { [key: string]: string } for header injection
```

**State Machine**:
```
START → onOperationStart
      → [Optional: onOperationProgress]
      → (onOperationEnd | onOperationError)
      → END
```

**Invariants**:
- `onOperationStart` always called first
- Either `onOperationEnd` OR `onOperationError` called (never both)
- `onOperationInject` may be called multiple times (caching up to instrumentation)

### Fetch Request Lifecycle

Similar to HTTP but initiated from client side:
```
1. onOperationStart(id, info)
   ├─ info.method: string
   ├─ info.url: string
   └─ info.headers: object (outgoing)

2. [In-flight] onOperationInject(id) → headers to add

3a. onOperationEnd(id, result)
   ├─ result.status_code: number
   ├─ result.headers: object (response)
   └─ result.content_length: number

3b. onOperationError(id, error)
   ├─ error.error_type: "NetworkError" | "TimeoutError" | ...
   └─ error.error_message: string
```

## Data Flow Diagrams

### Attach Flow
```
User Code                TypeScript                  Zig
   │                        │                         │
   │ attach(instrument)     │                         │
   ├───────────────────────>│                         │
   │                        │ validate functions      │
   │                        │ Bun.telemetry.attach()  │
   │                        ├────────────────────────>│
   │                        │                         │ generate ID
   │                        │                         │ create InstrumentRecord
   │                        │                         │ add to instrument_table[kind]
   │                        │<────────────────────────┤
   │<───────────────────────┤ return id               │
   │                        │                         │
```

### Operation Start Flow
```
HTTP Request            Zig Runtime              Instrumentation
   │                        │                         │
   │ incoming request       │                         │
   ├───────────────────────>│                         │
   │                        │ generate request_id     │
   │                        │ check isEnabledFor(http)│
   │                        │ build info object       │
   │                        │ for each instrument:    │
   │                        │   on_op_start_fn.call() │
   │                        ├────────────────────────>│
   │                        │                         │ create span
   │                        │                         │ store in map
   │                        │<────────────────────────┤
   │                        │ continue processing     │
   │<───────────────────────┤ Response                │
```

## OpenTelemetry Span Mapping

### Trace Span Entity

**OpenTelemetry Spec Fields** (not stored in Bun, created by packages/bun-otel):
```typescript
interface Span {
  traceId: string;          // 128-bit hex
  spanId: string;           // 64-bit hex
  parentSpanId?: string;
  name: string;             // Operation name
  kind: SpanKind;           // SERVER | CLIENT | INTERNAL
  startTime: HrTime;        // High-resolution timestamp
  endTime: HrTime;
  status: SpanStatus;       // OK | ERROR
  attributes: Attributes;   // Key-value pairs
  events: TimeEvent[];      // Logs attached to span
  links: Link[];            // Links to other spans
}
```

**Bun Native Data → Span Attributes** (mapping performed by BunHttpInstrumentation):
```typescript
// From onOperationStart(id, info)
info.method         → span.attributes["http.request.method"]
info.url            → span.attributes["url.path"] + ["url.query"]
info.headers["..."] → span.attributes["http.request.header.*"] (if configured)

// From onOperationEnd(id, result)
result.status_code    → span.attributes["http.response.status_code"]
result.content_length → span.attributes["http.response.body.size"]
result.headers["..."] → span.attributes["http.response.header.*"] (if configured)

// Span lifecycle
onOperationStart → span.start()
onOperationEnd   → span.end()
onOperationError → span.recordException() + span.setStatus(ERROR) + span.end()
```

### Trace Context Entity

**Purpose**: Propagate trace correlation across service boundaries

**W3C TraceContext Header Format**:
```
traceparent: 00-{traceId}-{spanId}-{flags}
tracestate: vendor1=value1,vendor2=value2

Example:
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
```

**Bun Handling**:
- **Inbound**: `onOperationStart` receives parsed traceparent as `info.traceContext`
- **Outbound**: `onOperationInject` returns headers to inject
- **Propagation**: AsyncLocalStorage maintains context through async boundaries

## Memory Management Model

### Protected JSValues

**Problem**: JavaScript objects passed to Zig must not be garbage collected while Zig holds references

**Solution**: Protect/Unprotect pattern
```zig
// On attach
const obj = instrument_obj;
obj.protect();  // Increments ref count

// On detach
obj.unprotect();  // Decrements ref count, allows GC
```

**Invariants**:
- Every `protect()` must have matching `unprotect()`
- Dispose methods must unprotect all protected values
- Use `defer` in Zig for exception safety

### Buffer Management

**Request ID Map** (TypeScript):
```typescript
// In BunHttpInstrumentation
private spans = new Map<number, Span>();

onOperationStart(id, info) {
  const span = tracer.startSpan(...);
  this.spans.set(id, span);  // Add
}

onOperationEnd(id, result) {
  const span = this.spans.get(id);
  span.end();
  this.spans.delete(id);  // Remove to prevent leak
}
```

**Invariants**:
- Spans removed from map after `onOperationEnd` or `onOperationError`
- Map size should stay bounded (no indefinite growth)

## Concurrency Model

### Thread Safety

**Bun Runtime**: Single-threaded JavaScript execution, multi-threaded I/O

**Atomic Counters**:
```zig
next_instrument_id: std.atomic.Value(u32)  // Thread-safe ID generation
next_request_id: std.atomic.Value(u64)     // Thread-safe request ID
```

**No Locks Needed**:
- Instrument registration happens on main thread
- Operation lifecycle callbacks execute on request thread
- No shared mutable state between requests

### Async Context Propagation

**Challenge**: Maintain trace context through async operations

**Solution**: AsyncLocalStorage (with Bun-specific workarounds)
```typescript
// Context flows through:
await Bun.sleep(100);     // ✅ Context preserved
await fetch(...);         // ✅ Context preserved
setTimeout(() => {}, 0);  // ✅ Context preserved
Promise.then(() => {});   // ✅ Context preserved

// Known limitation:
context.with(() => {});   // ⚠️ Workaround in BunAsyncLocalStorageContextManager
```

## Validation Rules

### Instrument Registration

- `type` must be valid InstrumentKind enum value
- `name` and `version` must be non-empty strings
- At least one hook function (`onOperation*`) must be provided
- Hook functions must be callable (checked at attach time)

### Operation Data

- Request IDs must be positive integers
- Status codes must be in range [100, 599]
- Headers must be objects with string keys and values
- URLs must be valid (no validation at Zig layer, handled by JavaScript)

### Header Capture

- Only allowlisted headers captured (deny-by-default)
- Default allowlist: `['content-type', 'user-agent', 'accept', 'content-length']`
- Sensitive headers never captured: `['authorization', 'cookie', 'set-cookie', 'api-key']`

## Performance Characteristics

### Overhead Targets

**Telemetry Disabled** (no instruments attached):
- `isEnabledFor(kind)` check: O(1), ~5ns
- Early return before any work
- **Target**: <0.1% latency impact

**Telemetry Enabled** (instruments attached):
- Instrument lookup: O(k) where k = number of instruments for kind (typically 1-3)
- Function call overhead: ~100ns per hook
- Attribute building: ~1μs for typical HTTP request
- **Target**: <5% latency impact

### Memory Usage

**Per Instrument**:
- InstrumentRecord: ~64 bytes
- Protected JSValue: ~16 bytes each × 6 = 96 bytes
- **Total**: ~160 bytes per instrument

**Per Request** (with telemetry):
- Request ID: 8 bytes
- Span object (JavaScript): ~500 bytes
- Attributes: ~200 bytes (typical HTTP span)
- **Total**: ~700 bytes per in-flight request

**Bounded Growth**:
- Max instruments: Unlimited, but typically <10 total
- Max in-flight requests: Bounded by HTTP server limits
- Maps cleaned up on request completion

## Conclusion

The data model is designed for:
1. **Performance**: Fixed-size lookups, cached function pointers, early returns
2. **Safety**: Protected JSValues, validation at attach time, defensive error handling
3. **Extensibility**: InstrumentKind enum easily extended, generic operation lifecycle
4. **Memory Safety**: Explicit cleanup paths, using/defer patterns, bounded maps

Next: API contracts and quickstart guide.
