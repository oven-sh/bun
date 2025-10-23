# ADR-002: Hook Lifecycle and Attribute Design

**Status**: Accepted
**Date**: 2025-10-21
**Feature**: OpenTelemetry Support for Bun

## Context

Instrumentation hooks need consistent data format and lifecycle management to enable OpenTelemetry integration while maintaining performance and security.

## Decisions

### 1. Semantic Convention Attributes Only

**Decision**: Zig layer produces OpenTelemetry semantic convention attributes, TypeScript consumes them directly.

**Rationale**:
- OpenTelemetry already defines standard attribute names (http.request.method, url.path, etc.)
- No translation needed in TypeScript - direct `span.setAttributes(attributes)`
- Avoids custom object formats that require conversion
- Reduces coupling between Zig and TypeScript layers
- Industry-standard attribute names improve interoperability

**Flow**: `Zig Runtime → AttributeMap → toJS() → Record<string, any> → Hook → OpenTelemetry Span`

**Consequences**:
- All attribute keys follow OpenTelemetry semantic conventions
- TypeScript code is simpler (no mapping logic)
- Future OpenTelemetry updates require Zig changes
- Documentation can reference OpenTelemetry specs

### 2. Deny-By-Default Header Capture

**Decision**: Headers must be explicitly allowlisted for capture via `captureAttributes` configuration.

**Rationale**:
- Headers often contain sensitive data (tokens, cookies, API keys)
- Security should be default-safe
- Users must consciously opt-in to capture specific headers
- Prevents accidental credential leakage in telemetry

**Default Capture List** (safe headers only):
```typescript
{
  requestHeaders: ["content-type", "content-length", "user-agent", "accept"],
  responseHeaders: ["content-type", "content-length"]
}
```

**Consequences**:
- Max 50 headers per list (DOS prevention)
- Headers must be lowercase strings
- Sensitive headers always blocked regardless of configuration
- Users must update configuration to capture custom headers

### 3. Hook Signature Consistency

**Decision**: All hooks receive `(id: number, attributes: Record<string, any>)` parameters.

**Rationale**:
- Consistent API across all hook types
- Operation ID enables correlation across hooks
- Attributes provide all necessary context
- No need for different signatures per hook type

**Consequences**:
- Simple mental model for instrumentation authors
- Easy to add new hooks without API changes
- All data passed via attributes (no additional parameters)

### 4. Incremental Progress Updates

**Decision**: `onOperationProgress` provides incremental updates during long operations.

**Rationale**:
- Some operations take significant time (large uploads, streaming)
- Users need visibility into operation progress
- Allows adding events to spans without ending them
- Not all operations need progress updates (optional)

**Consequences**:
- May be called 0-N times per operation
- Attributes are incremental (not full state)
- Used primarily for adding span events
- Not guaranteed for all operation types

### 5. Error vs End Separation

**Decision**: Separate `onOperationEnd` (success) and `onOperationError` (failure) hooks.

**Rationale**:
- Clear distinction between success and failure paths
- Different attributes available in error cases
- Aligns with OpenTelemetry span status model
- Simplifies instrumentation logic (no need to check for errors)

**Consequences**:
- Exactly one of End or Error called per operation
- Error hook receives exception details in attributes
- Span status set based on which hook is called

## Alternatives Considered

### Alternative: Custom Object Format
**Rejected**: Would require translation layer in TypeScript, adding complexity and overhead.

### Alternative: Capture All Headers by Default
**Rejected**: Security risk - could leak authentication tokens, session cookies, API keys.

### Alternative: Different Hook Signatures per Type
**Rejected**: Increases API complexity without significant benefit.

### Alternative: Single End Hook with Success Flag
**Rejected**: Less clear, requires conditional logic in every instrumentation.

## References

- OpenTelemetry Semantic Conventions
- OpenTelemetry JavaScript SDK
- W3C Trace Context specification