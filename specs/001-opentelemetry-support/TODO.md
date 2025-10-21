# OpenTelemetry Support - TODO

## Current Status
- ✅ Native telemetry API (`Bun.telemetry.attach/detach/isEnabledFor`)
- ✅ HTTP server hooks (Bun.serve)
- ✅ Fetch client hooks
- ✅ Tests for native hooks

## Pending Work

### 1. Header Injection Implementation (P0 - Blocking Distributed Tracing)
**Spec**: `contracts/header-injection.md`, `header-injection-implementation-plan.md`

**Status**: Specified, ready for implementation

**Approach**: Linear concatenation (duplicates allowed)
- Config arrays: `["traceparent", "x-custom", "traceparent"]` (duplicates OK)
- Injection: Call `headers.set(key, value)` for each entry (even duplicates)
- Behavior: Last `set()` wins per HTTP Headers API
- Rationale: Simplest implementation, defers merge logic to Headers

**Tasks**:
- [ ] Phase 1: Configuration infrastructure (InjectConfig struct, caching)
- [ ] Phase 2: HTTP server response header injection (server.zig)
- [ ] Phase 3: Fetch client request header injection (fetch.zig)
- [ ] Phase 4: Security validation (blocked headers, limits)

**Estimate**: 2-3 days

---

### 2. Future Optimizations (YAGNI - Profile First)

**Deduplication**: If profiling shows header array duplicates cause measurable overhead:
- Use `std.StringHashMap` to collect unique keys during `rebuildInjectConfig()`
- Estimated gain: <1% (duplicates are edge case)
- Decision: Defer until proven necessary

**tracestate Concatenation**: W3C spec allows comma-separated vendor state:
- Current: Last instrument wins (simple)
- Future: Prepend values: `"vendor2=val2,vendor1=val1"`
- Decision: Wait for user demand (single-vendor is typical)

---

## Notes

- Header merge behavior uses **linear concatenation** (not deduplication)
- Multiple `set()` calls per request if duplicates exist (negligible overhead)
- Headers API handles final merge per HTTP spec
- Edge case: Multiple instruments declaring same header is rare in practice
