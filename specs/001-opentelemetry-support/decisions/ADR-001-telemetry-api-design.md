# ADR-001: Telemetry API Design Decisions

**Status**: Accepted
**Date**: 2025-10-21
**Feature**: OpenTelemetry Support for Bun

## Context

The Bun.telemetry API provides instrumentation hooks for observability tools like OpenTelemetry. This ADR documents key design decisions made for the native telemetry layer.

## Decisions

### 1. Defensive Isolation for Hook Errors

**Decision**: Errors in instrumentation hooks must not crash the Bun runtime.

**Rationale**:
- Telemetry is auxiliary functionality - it should never break core application behavior
- Third-party instrumentation packages may have bugs
- Users shouldn't need to debug instrumentation issues in production
- Silent failures are worse than logged errors with continued operation

**Consequences**:
- Hooks wrapped in error handlers at the Zig layer
- Errors logged to stderr with context (instrument name, version)
- Request processing continues normally after hook errors
- Other instruments still get invoked even if one fails

### 2. Reference Counting for JavaScript Objects

**Decision**: Use protect/unprotect reference counting for JSValues held by Zig.

**Rationale**:
- JavaScript garbage collector doesn't know about Zig references
- Objects could be GC'd while Zig still holds pointers (crash/corruption)
- Need deterministic cleanup when instruments are detached
- JavaScriptCore provides protect/unprotect API for this exact use case

**Consequences**:
- ~96 bytes overhead per instrument (6 protected values × 16 bytes)
- Every protect() must have matching unprotect()
- Exception safety via Zig `defer` blocks
- Memory immediately freed on detach()

### 3. Single-Threaded Execution Model

**Decision**: Attach/detach operations restricted to main JavaScript thread.

**Rationale**:
- JavaScript is single-threaded by design
- No need for complex locking mechanisms
- Hook invocation happens on request thread (may vary)
- ID generation uses atomics for thread safety

**Consequences**:
- Simple implementation without mutexes
- No race conditions in registration/unregistration
- Hook execution serialized per request
- Can't attach/detach from worker threads (acceptable limitation)

### 4. Deny-By-Default Header Capture Security

**Decision**: Only explicitly allowlisted headers are captured, sensitive headers always blocked.

**Rationale**:
- Security must be default-safe
- Telemetry shouldn't accidentally leak credentials
- Headers like `authorization`, `cookie`, `x-api-key` contain secrets
- Users must opt-in to capture specific headers

**Consequences**:
- Default capture list includes only safe headers (content-type, accept, etc.)
- Sensitive headers rejected at attach() time (fail-fast)
- Maximum 50 headers per list (DOS prevention)
- Headers must be lowercase strings

### 5. Performance Targets

**Decision**: <0.1% overhead when disabled, <5% overhead when enabled.

**Rationale**:
- Bun's core value proposition is speed
- Telemetry shouldn't significantly impact performance
- Early return checks (`isEnabledFor()`) must be extremely fast (~5ns)
- Attribute building deferred until after enablement check

**Consequences**:
- O(1) enablement checks via array length
- Minimal memory allocation (~160 bytes per instrument)
- Hook overhead ~100ns per invocation
- No async hooks (would add event loop overhead)

### 6. Backward Compatibility Strategy

**Decision**: API stable within Bun 1.x series, new InstrumentKind values additive only.

**Rationale**:
- Breaking changes would fragment the ecosystem
- Instrumentation packages need stable targets
- New operation types will emerge over time
- Enum values never reused (monotonic progression)

**Consequences**:
- Existing InstrumentKind values never change behavior
- New kinds ignored by older instrumentation (graceful degradation)
- Hook signatures may gain optional fields (backward compatible)
- Migration path from deprecated configure() API documented

## Alternatives Considered

### Alternative: Let Hooks Crash Runtime
**Rejected**: Would make telemetry a reliability risk rather than observability aid.

### Alternative: Copy JSValues Instead of Reference Counting
**Rejected**: Would significantly increase memory usage and GC pressure.

### Alternative: Async Hooks
**Rejected**: Would require event loop integration, adding complexity and overhead.

### Alternative: Capture All Headers by Default
**Rejected**: Security risk - could leak authentication tokens, cookies, API keys.

## References

- OpenTelemetry JavaScript API specification
- JavaScriptCore memory management documentation
- Bun performance requirements