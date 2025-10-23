# Contract: Telemetry Context API (Zig Runtime)

**Feature**: OpenTelemetry Support for Bun
**Component**: TelemetryContext (Zig runtime instrumentation API)
**Scope**: Zig-side API for instrumenting native code at operation insertion points
**Audience**: Bun core contributors adding telemetry to server.zig, fetch.zig, etc.

**Related**: See `telemetry-global.md` for TypeScript bridge API (nativeHooks) and global configuration

# Purpose

Provide ergonomic, zero-overhead API for instrumenting Bun's native code with OpenTelemetry telemetry. When telemetry is disabled, instrumentation code should have zero runtime cost.

# API Surface

## Design Rationale

The `notifyOperation*` methods all share a symmetric signature: `(self, comptime kind: InstrumentKind, id: u64, attrs: *AttributeMap)`. This design enables:

1. **Efficient callback dispatch**: Native instruments are stored in `array[InstrumentKind.COUNT]`, allowing O(1) lookup using the comptime `kind` parameter
2. **Code size reduction**: Symmetric signatures eliminate 4/5 of the SLOC compared to mismatched APIs
3. **Zero-cost abstraction**: The comptime `kind` parameter allows the compiler to completely optimize away the dispatch logic
4. **Stack allocation**: AttributeMap stays on the stack at the insertion point; conversion to JSValue happens internally
5. **GlobalObject independence**: Supports shadowRealm and multiple globalObject contexts - instrumentation may run in different realm than execution

## OperationType

```zig
pub const OperationType = enum {
    start = 0,
    progress = 1,
    end = 2,
    error = 3,
    inject = 4,
};
```

## ConfigurationProperty

**See**: `specs/001-opentelemetry-support/contracts/telemetry-global.md` for the authoritative `ConfigurationProperty` enum definition (used in TypeScript nativeHooks API).

The Zig-side enum is a comptime mapping of the TypeScript enum values.

## TelemetryContext

Central context struct providing access to telemetry configuration and operations:

```zig
pub const TelemetryContext = struct {
    /// Semantic conventions singleton (AttributeKeys)
    semconv: *AttributeKeys,

    /// Create a new AttributeMap for building operation attributes
    /// AttributeMaps are stack-allocated and do not require cleanup
    /// JSValue conversions happen internally - pass by pointer (&attrs) to notify methods
    /// NEVER call AttributeMap.toJS() yourself - conversion happens automatically inside notify methods
    pub inline fn createAttributeMap(self: *TelemetryContext) AttributeMap;

    /// Create a unique operation_id
    /// IDs are globally unique, monotonically increasing, and thread-safe
    /// Note: Zig returns OpId (u64 type alias defined in src/telemetry/main.zig:15),
    ///       converted to JavaScript number with branded OpId type (53-bit safe precision)
    /// See telemetry-global.md for TypeScript-side OpId semantics
    pub inline fn generateId(self: *TelemetryContext) OpId;

    /// Notify TypeScript layer of an operation event
    /// This is the low-level API for advanced use cases
    /// The helper methods below (notifyOperationStart, etc.) are preferred
    /// They are distinct inline implementations optimized for their specific operation type
    /// @param op: Operation type (start, progress, end, error, inject)
    /// @param kind: Instrumentation Target (comptime for O(1) dispatch)
    /// @param id: OpId from generateId()
    /// @param attrs: *AttributeMap with operation attributes
    /// @return JSValue (.js_undefined except for inject which returns injection data)
    pub inline fn notifyOperation(
        self: *TelemetryContext,
        comptime op: OperationType,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap
    ) JSValue;

    /// Notify TypeScript layer of operation start
    /// @param kind: Instrumentation Target
    /// @param id: OpId from generateId()
    /// @param attrs: *AttributeMap with start attributes
    pub inline fn notifyOperationStart(
        self: *TelemetryContext,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap
    ) void;

    /// Notify TypeScript layer of operation progress
    /// @param kind: Instrumentation Target
    /// @param id: OpId from generateId()
    /// @param attrs: *AttributeMap with progress attributes
    pub inline fn notifyOperationProgress(
        self: *TelemetryContext,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap
    ) void;

    /// Notify TypeScript layer of operation completion
    /// @param kind: Instrumentation Target
    /// @param id: OpId from generateId()
    /// @param attrs: *AttributeMap with end attributes
    pub inline fn notifyOperationEnd(
        self: *TelemetryContext,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap
    ) void;

    /// Notify TypeScript layer of operation error
    /// @param kind: Instrumentation Target
    /// @param id: OpId from generateId()
    /// @param attrs: *AttributeMap with error attributes
    pub inline fn notifyOperationError(
        self: *TelemetryContext,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap
    ) void;

    /// Request injection data from TypeScript layer
    /// Format of returned data is instrument-specific (see telemetry-http.md for HTTP header injection)
    /// @param kind: Instrumentation Target
    /// @param id: OpId from generateId()
    /// @param attrs: *AttributeMap with injection context, or empty map if no context needed
    /// @return JSValue with instrument-specific injection data
    pub inline fn notifyOperationInject(
        self: *TelemetryContext,
        comptime kind: InstrumentKind,
        id: OpId,
        attrs: *AttributeMap
    ) JSValue;

    /// Get a configuration property value (e.g., list of headers to propagate)
    /// Properties are computed from ENV vars intersected with instrument configuration
    /// @param property: Configuration property identifier (comptime enum)
    /// @return ConfigurationValue - comptime struct type based on property
    ///         For header properties: returns AttributeList
    ///         (TypeScript nativeHooks.getConfigurationProperty returns JSValue/any/string[])
    pub inline fn getConfigurationProperty(
        self: *TelemetryContext,
        comptime property: ConfigurationProperty
    ) ConfigurationValue(property);

};
```

## Global Telemetry API

For module-level functions like `bun.telemetry.enabled()`, `init()`, `attach()`, and `detach()`, see `specs/001-opentelemetry-support/contracts/telemetry-global.md`.

# Usage Pattern

## Standard Instrumentation Pattern

```zig
// In HTTP server request handler
pub fn onRequest(req: *uws.Request, resp: *Response) void {
    // Check if telemetry enabled - zero cost if disabled
    if (bun.telemetry.enabled()) |otel| {
        const op_id = otel.generateId();
        ctx.start_time_ns = @intCast(std.time.nanoTimestamp());

        // Build start attributes (stack-allocated)
        var attrs = otel.createAttributeMap();
        attrs.set(otel.semconv.http_request_method, method);
        attrs.set(otel.semconv.url_path, path);
        attrs.set(otel.semconv.url_query, query);
        otel.notifyOperationStart(.http, op_id, &attrs);

        // Store op_id for later use in response handler
        ctx.telemetry_op_id = op_id;
    }

    // ... normal request processing
}

pub fn onResponse(ctx: *RequestContext, status_code: u16) void {
    if (bun.telemetry.enabled()) |otel| {
        if (ctx.telemetry_op_id) |op_id| {
            // Build end attributes (stack-allocated)
            var attrs = otel.createAttributeMap();
            attrs.set(otel.semconv.http_response_status_code, JSValue.jsNumber(status_code));

            // Notify completion
            otel.notifyOperationEnd(.http, op_id, &attrs);
        }
    }
}
```

## Header Injection Pattern

**See**: `specs/001-opentelemetry-support/contracts/telemetry-http.md` for HTTP-specific header injection implementation details.

General pattern for operations requiring header injection:

```zig
// In operation before sending/processing
pub fn beforeOperation(req: *Request) void {
    if (bun.telemetry.enabled()) |otel| {
        const op_id = otel.generateId();

        // Notify operation start
        var start_attrs = otel.createAttributeMap();
        start_attrs.set(otel.semconv.operation_type, operation_type_value);
        otel.notifyOperationStart(.fetch, op_id, &start_attrs);

        // Request injection data from instrumentation
        var inject_context = otel.createAttributeMap();
        const injection_data: JSValue = otel.notifyOperationInject(.fetch, op_id, &inject_context);

        // Process injection_data according to operation-specific contract
        // (See telemetry-http.md for HTTP header injection format)
    }
}
```

## Error Handling Pattern

```zig
pub fn onError(ctx: *RequestContext, err: anyerror) void {
    if (bun.telemetry.enabled()) |otel| {
        if (ctx.telemetry_op_id) |op_id| {
            var attrs = otel.createAttributeMap();
            attrs.set(otel.semconv.error_type, errorName(err));
            attrs.set(otel.semconv.exception_message, errorMessage(err));

            otel.notifyOperationError(.fetch, op_id, &attrs);
        }
    }
}
```

# Implementation Notes

## Functional Requirements

All functional requirements for the TelemetryContext API are documented in `specs/001-opentelemetry-support/spec.md` (FR-025 through FR-046), including:

- Performance requirements (inlining, zero-overhead when disabled)
- Memory management (stack allocation, no cleanup required)
- Error handling (graceful degradation, no exceptions)
- Thread safety (all operations are thread-safe via atomic operations)
- ShadowRealm support (API surface designed to support multiple realm contexts - see spec.md FR-038 through FR-041)
- GlobalObject binding (first `attach()` captures GlobalObject, subsequent calls from different realm throw, binding resets when all instruments removed - see spec.md FR-042 through FR-046)

# Integration with TypeScript Layer

## Operation Lifecycle

```
Native (Zig)                     TypeScript (Instrumentation)
    |                                     |
    | generateId() -> operation_id        |
    |                                     |
    | notifyOperationStart(kind, id, attrs) |
    |------------------------------------>|
    |                                     | Create span/metric using id
    |                                     |
    | notifyOperationProgress(kind, id, attrs) |
    |------------------------------------>|
    |                                     | Add span events
    |                                     |
    | notifyOperationInject(kind, id, data) |
    |------------------------------------>|
    |                                     | Generate trace context headers
    |                         header_values (JSValue array)
    |<------------------------------------|
    |                                     |
    | notifyOperationEnd(kind, id, attrs) |
    |------------------------------------>|
    |                                     | End span, record metrics
    |                                     |
```

## Callback Interface

TypeScript instrumentation layer MUST implement:

```typescript
// Internal API type - uses branded number for type safety
export type OpId = number & { readonly __brand: 'OpId' };

interface NativeInstrument {
  // Each instrument is registered for a specific InstrumentKind
  // The native layer stores instruments in an array indexed by InstrumentKind
  // All callbacks receive the OpId generated by Zig

  // Lifecycle callbacks (optional)
  onAttach?(): void;
  onDetach?(): void;

  // Operation callbacks (required)
  onOperationStart(
    operationId: OpId,
    attributes: Record<string, any>,
  ): void;

  onOperationProgress(
    operationId: OpId,
    attributes: Record<string, any>,
  ): void;

  onOperationEnd(
    operationId: OpId,
    attributes: Record<string, any>,
  ): void;

  onOperationError(
    operationId: OpId,
    attributes: Record<string, any>,
  ): void;

  onOperationInject(
    operationId: OpId,
    context: Record<string, any>,
  ): any; // Return value is instrument-specific (e.g., string[] for HTTP header values)
}
```

# InstrumentKind Enum

The `InstrumentKind` enum defines the types of operations that can be instrumented. This enum is used as a comptime parameter to `notifyOperation*` methods, allowing the native layer to efficiently route callbacks to the appropriate TypeScript instrument.

**See**: `specs/001-opentelemetry-support/contracts/telemetry-global.md` for the authoritative enum definition (Zig and TypeScript).

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

Each instrument registers for a specific InstrumentKind. When Zig calls `notifyOperation*(.fetch, ...)`, the native layer uses the enum value (comptime known) to index into `instruments[InstrumentKind.COUNT]` array and calls the appropriate TypeScript callback with O(1) lookup and zero runtime overhead.

# Attribute Naming Conventions

All attributes MUST use OpenTelemetry semantic convention names:

- HTTP: `http.request.method`, `http.response.status_code`, `http.route`
- URL: `url.path`, `url.query`, `url.scheme`, `url.full`
- Server: `server.address`, `server.port`
- Client: `client.address`, `client.port`
- Network: `network.protocol.name`, `network.transport`
- Error: `error.type`, `exception.type`, `exception.message`, `exception.stacktrace`
- Headers: `http.request.header.*`, `http.response.header.*`
- Trace Context: `trace.parent.trace_id`, `trace.parent.span_id`, `trace.parent.trace_flags`

See `@opentelemetry/semantic-conventions` for authoritative list.

# Zero-Overhead Guarantee

When telemetry is disabled (`enabled()` returns null):

```zig
// This code:
if (bun.telemetry.enabled()) |otel| {
    const op_id = otel.generateId();
    var attrs = otel.createAttributeMap();
    attrs.set(otel.semconv.http_request_method, method);
    otel.notifyOperationStart(.http, op_id, &attrs);
}

// Compiles to (when disabled):
if (false) {
    // Dead code, completely eliminated by optimizer
}

// Which optimizes to:
// (nothing - zero instructions)
```

**Verification**: Use `zig build-obj -O ReleaseFast` and inspect assembly. Instrumentation blocks must produce zero code when telemetry disabled.

# Testing Requirements

## Unit Tests

- Test `enabled()` returns null when not initialized
- Test `enabled()` returns context when initialized
- Test operation ID monotonic increment and thread safety
- Test AttributeMap lifecycle (createAttributeMap → set → pass to notify)
- Test header injection round-trip with AttributeList configuration

## Integration Tests

- Test full operation lifecycle (start → progress → end)
- Test error notification
- Test header injection with real TypeScript callbacks
- Test thread safety of enabled() and generateId()
- Test performance impact when enabled vs disabled
- Test shadowRealm support with different globalObject contexts

## Performance Tests

- Benchmark `enabled()` check overhead (must be <1ns)
- Benchmark AttributeMap creation and attribute setting
- Benchmark notifyOperation\* calls with varying attribute counts
- Verify zero overhead when disabled (compare binary size, instruction count)

# Migration from Previous Implementation

Previous implementation used:

- `attrs.fastSet(.enum_value, ...)` - Enum-based keys
- Direct enum indexing into arrays
- Bitpacked u16 attribute keys
- `attrs.toJS(globalObject)` - Explicit globalObject parameter

New implementation uses:

- `attrs.set(otel.semconv.field_name, ...)` - Pointer-based keys
- Stack-allocated AttributeMap
- Pointer passing to notify methods (`&attrs`)
- Clean separation of concerns (AttributeKey vs AttributeMap)
- Internal globalObject management (supports shadowRealms)

Migration pattern:

```zig
// OLD (incorrect - manual toJS() call required)
attrs.fastSet(.http_request_method, method);
otel.notifyOperationStart(.http, op_id, attrs.toJS(globalObject));
// Problems:
// 1. Caller must track and pass globalObject
// 2. toJS() called explicitly at call site
// 3. Doesn't support shadowRealms (single globalObject)

// NEW (correct - pass by pointer, automatic conversion)
if (bun.telemetry.enabled()) |otel| {
    var attrs = otel.createAttributeMap();
    attrs.set(otel.semconv.http_request_method, method);
    otel.notifyOperationStart(.http, op_id, &attrs);  // Pass by pointer - toJS() happens internally
}
// Benefits:
// 1. No globalObject tracking needed
// 2. toJS() conversion handled internally by notify method
// 3. Supports shadowRealms (globalObject managed by TelemetryContext)
```

# Related Documents

- `specs/001-opentelemetry-support/contracts/attributes.md` - AttributeKey, AttributeMap, AttributeList contracts
- `specs/001-opentelemetry-support/contracts/telemetry-global.md` - Module-level telemetry API (enabled, init, attach, detach)
- `specs/001-opentelemetry-support/contracts/telemetry-http.md` - HTTP-specific instrumentation and header injection format
- `specs/001-opentelemetry-support/data-model.md` - Overall data model and hook lifecycle
- `packages/bun-otel/src/instruments/` - TypeScript instrumentation implementations
