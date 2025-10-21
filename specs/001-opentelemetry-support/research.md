# Research: OpenTelemetry Support for Bun

**Date**: 2025-10-20
**Feature**: OpenTelemetry Traces, Metrics, and Logs
**Branch**: `001-opentelemetry-support`
**Prior Work**: `feat/opentelemetry-server-hooks` branch (working implementation)

## Overview

This document captures architectural decisions, best practices research, and technical rationale for implementing OpenTelemetry support in Bun runtime.

**Current State**: A working implementation exists in `feat/opentelemetry-server-hooks` branch with:

- Native Zig hooks for HTTP server and fetch instrumentation
- `packages/bun-otel/` TypeScript package with BunSDK, instrumentations, and examples
- Comprehensive test coverage (core hooks + OTel integration)
- Distributed tracing, metrics, and basic logging support

**This Spec**: Defines the refactor from monolithic `configure()` API to extensible `attach/detach` model and addition of P3 (logging helpers) features.

## Key Architectural Decisions

### Decision 1: Native Hooks vs Monkey-Patching

**Chosen**: Native Zig-layer telemetry hooks

**Rationale**:

- 10x performance improvement over JavaScript monkey-patching (measured in existing `feat/opentelemetry-server-hooks` branch)
- Zero-cost abstraction when telemetry disabled (compile-time feature flags)
- Avoids fragility of patching internals
- Future-proof: hooks are stable API surface

**Alternatives Considered**:

- **Monkey-patching** (`AsyncLocalStorage` + wrapper functions): Rejected due to 10x performance penalty, fragility, maintenance burden
- **User-space instrumentation only**: Rejected because can't intercept `Bun.serve()` internals without hooks

**References**:

- `/TELEMETRY_OVERVIEW.md` - Native telemetry architecture design
- `/TELEMETRY_REFACTOR.md` - Refactor plan from configure() to attach/detach model

### Decision 2: Attach/Detach Instrumentation Model

**Chosen**: Generic operation lifecycle with `InstrumentKind` enum

**Rationale**:

- Extensible to future operations (SQL, Redis, AWS) without Zig code changes
- Multiple instrumentations can coexist (metrics + tracing simultaneously)
- Standard pattern from Node.js diagnostics_channel
- Enables third-party instrumentations

**Alternatives Considered**:

- **Monolithic configure()** (existing impl): Rejected because can't add/remove instrumentations independently, testing difficult
- **One hook per operation type**: Rejected due to code duplication, hard to extend

**API Surface**:

```typescript
Bun.telemetry.attach(instrument: NativeInstrument): number
Bun.telemetry.detach(id: number): boolean
Bun.telemetry.listInstruments(kind?: InstrumentKind): Array<InstrumentInfo>
Bun.telemetry.getActiveSpan(): { traceId: string, spanId: string } | null
```

**References**:

- `/TELEMETRY_OVERVIEW.md` sections 2-3 - Attach/Detach model design
- `/TELEMETRY_REFACTOR.md` - Detailed 7-10 day refactor plan

**Implementation Status**:

- ✅ Native hooks implemented with `configure()` API (existing)
- 🔄 Refactor to `attach/detach` planned (7-10 days, see TELEMETRY_REFACTOR.md)

### Decision 3: Package Structure (Bun Core vs npm Package)

**Chosen**: Native hooks in Bun core, OpenTelemetry integration as `packages/bun-otel` npm package

**Rationale**:

- **Bun core cannot depend on `@opentelemetry/*` packages** - keeps core dependency-free
- Users opt-in by `bun add @bun/otel` (or equivalent npm package name)
- Native hooks are generic - work for any telemetry system (not just OpenTelemetry)
- Clear separation: hooks (Zig) vs instrumentation logic (TypeScript)

**Structure**:

```
src/bun.js/telemetry*.zig          → Bun core (no OTel deps)
packages/bun-otel/                 → npm package (@opentelemetry/* deps OK)
test/js/bun/telemetry/             → Core tests (NO OTel deps)
packages/bun-otel/test/            → Package tests (OTel deps OK)
test/integration/opentelemetry/    → Standalone integration tests
```

**Alternatives Considered**:

- **Bundle @opentelemetry/\* in Bun core**: Rejected - increases bundle size, couples Bun to OTel releases
- **User-space only (no native hooks)**: Rejected - can't achieve performance goals, can't intercept Bun.serve() internals

**References**:

- `/TELEMETRY_RESTRUCTURE.md` - Package reorganization plan
- User feedback on plan.md structure (2025-10-20)

### Decision 4: Context Propagation Strategy

**Chosen**: AsyncLocalStorage with custom workarounds for Bun limitations

**Rationale**:

- Node.js OpenTelemetry SDK already uses AsyncLocalStorage
- Bun's AsyncLocalStorage is mostly compatible
- Known limitation: `context.with()` doesn't propagate in Bun - workaround via custom ContextManager
- Future: Bun may improve AsyncLocalStorage to full Node.js parity

**Implementation**:

- `packages/bun-otel/src/context/AsyncContextManager.ts` - Custom context manager
- Wraps `@opentelemetry/context-async-hooks` with Bun-specific fixes
- Documents workarounds in package README

**Alternatives Considered**:

- **Wait for Bun AsyncLocalStorage fixes**: Rejected - blocks feature delivery
- **Zone.js**: Rejected - browser-only, doesn't work in Bun

**References**:

- `/OTEL_FEATURES.md` line 81-84 - Known AsyncLocalStorage limitations
- `@opentelemetry/context-async-hooks` source code

### Decision 5: Header Capture Security Model

**Chosen**: Deny-by-default with explicit allowlist, safe defaults provided

**Rationale**:

- **Security**: Prevents accidental PII/credential exposure
- **Compliance**: GDPR/privacy regulations require explicit consent
- **Usability**: Safe defaults (content-type, user-agent, accept, content-length) work out-of-the-box
- **Flexibility**: Users can add headers via configuration

**Default Allowlist**:

```typescript
["content-type", "user-agent", "accept", "content-length"];
```

**Blocked by Default**: authorization, cookie, set-cookie, api-key, x-api-key, proxy-authorization

**Configuration**:

```typescript
new BunHttpInstrumentation({
  requestHeaders: ["content-type", "user-agent", "x-custom-header"],
  responseHeaders: ["content-type", "x-trace-id"],
});
```

**Alternatives Considered**:

- **Capture all headers**: Rejected - security/privacy risk
- **Automatic PII detection**: Rejected - false positives/negatives, expensive at runtime
- **Blocklist approach**: Rejected - fails-open (unsafe by default)

**References**:

- Clarification session 2025-10-20, Question 2
- OWASP Top 10 - Sensitive Data Exposure
- `@opentelemetry/instrumentation-http` security practices

### Decision 6: Exporter Failure Handling

**Chosen**: Bounded retry with exponential backoff (3 attempts), then drop

**Rationale**:

- **Reliability**: Handles transient network failures (99% of exporter failures)
- **Safety**: Prevents memory exhaustion on prolonged outages
- **Observability**: Application stability > complete telemetry data

**Configuration**:

```typescript
{
  maxRetries: 3,
  initialBackoff: 100ms,
  maxBackoff: 5s,
  backoffMultiplier: 2
}
```

**Behavior**:

1. Export fails → buffer batch
2. Retry after 100ms → fails → buffer
3. Retry after 200ms → fails → buffer
4. Retry after 400ms → fails → **drop batch**
5. Log warning, continue application

**Alternatives Considered**:

- **Infinite retry**: Rejected - OOM risk on prolonged outages
- **No retry (fail-fast)**: Rejected - loses data on transient failures
- **Persistent queue (disk)**: Rejected - adds complexity, I/O overhead, disk space concerns

**References**:

- Clarification session 2025-10-20, Question 1
- `@opentelemetry/exporter-trace-otlp-http` retry logic
- OpenTelemetry specification on exporter requirements

### Decision 7: Default Sampling Strategy

**Chosen**: AlwaysOn (100% sampling)

**Rationale**:

- **Developer experience**: New users expect to see all traces
- **Debugging**: 100% sampling crucial during development
- **Migration**: Matches Node.js OpenTelemetry SDK defaults
- **Production**: Users explicitly configure sampling (ParentBased, Probabilistic) for production

**Configuration**:

```typescript
new NodeSDK({
  sampler: new AlwaysOnSampler(), // Default
  // Production: new ParentBasedSampler({
  //   root: new TraceIdRatioBasedSampler(0.1)  // 10% sampling
  // })
});
```

**Alternatives Considered**:

- **AlwaysOff**: Rejected - users won't see traces, think it's broken
- **10% default**: Rejected - confusing for new users ("where are my traces?")
- **ParentBased**: Rejected - requires upstream services to have sampling, doesn't work for root services

**References**:

- Clarification session 2025-10-20, Question 4
- `@opentelemetry/sdk-trace-base` sampler implementations
- OpenTelemetry sampling best practices

### Decision 8: Logging Integration Approach

**Chosen**: Dual approach - high-level formatters + low-level API

**Rationale**:

- **Convenience**: High-level formatters for pino/winston cover 80% use case
- **Flexibility**: Low-level `getActiveSpan()` for custom loggers
- **No lock-in**: Doesn't force specific logging framework

**High-Level** (`packages/bun-otel/src/instruments/logging/`):

```typescript
import { PinoFormatter } from "@bun/otel/logging";

const logger = pino({
  mixin: PinoFormatter.mixin(),
});
// Automatically injects traceId, spanId into logs
```

**Low-Level** (`Bun.telemetry.getActiveSpan()`):

```typescript
const span = Bun.telemetry.getActiveSpan();
logger.info({ traceId: span?.traceId, spanId: span?.spanId }, "message");
```

**Alternatives Considered**:

- **Bun-specific logger only**: Rejected - forces logger choice
- **console.log monkey-patching**: Rejected - fragile, performance overhead
- **Manual only**: Rejected - poor DX, boilerplate

**References**:

- Clarification session 2025-10-20, Question 5
- `@opentelemetry/winston-transport` design patterns
- pino logging best practices

## Best Practices Research

### OpenTelemetry Semantic Conventions

**HTTP Server Spans** (stable since v1.23.0):

- `http.request.method`: HTTP method (GET, POST, etc.)
- `url.path`: Request path without query string
- `url.query`: Query string (optional, redact sensitive params)
- `http.response.status_code`: Status code (200, 404, 500, etc.)
- `user_agent.original`: User-Agent header value
- `server.address`: Server host/address
- `server.port`: Server port
- `error.type`: Error code on failures

**HTTP Client Spans** (stable since v1.23.0):

- `http.request.method`: HTTP method
- `url.full`: Complete URL (redact sensitive query params)
- `http.response.status_code`: Status code
- `server.address`: Target server
- `server.port`: Target port

**Span Naming**:

- Server: `HTTP {method}` (e.g., "HTTP GET")
- Client: `HTTP {method}` (e.g., "HTTP POST")
- With route: `GET /api/users/:id`

**References**:

- OpenTelemetry Semantic Conventions v1.23.0+
- `/OTEL_FEATURES.md` lines 28-98 - Semantic conventions comparison

### Performance Benchmarking Strategy

**Baseline Measurement**:

1. Plain `Bun.serve()` without any telemetry
2. Measure: p50, p95, p99 latency at 1k, 5k, 10k RPS
3. Measure: memory usage under sustained load

**With Telemetry Disabled**:

- Expected: <0.1% overhead (compile-time zero-cost)
- Test: Same benchmark, hooks attached but no exporter

**With Telemetry Enabled**:

- Expected: <5% latency increase
- Test: Same benchmark, full tracing with console exporter (no network)

**With Real Exporter**:

- Expected: <10% latency increase (network I/O)
- Test: OTLP exporter to local collector

**Benchmark Tool**: `autocannon` (HTTP load generator)

```bash
bun bd
autocannon -c 100 -d 30 http://localhost:3000
```

**References**:

- Success criteria SC-003, SC-004 from spec.md
- Principle II (Performance-First) from constitution
- `/OTEL_FEATURES.md` performance comparison data

### Testing Strategy

**Unit Tests** (`packages/bun-otel/test/`):

- Mock `Bun.telemetry` hooks
- Test instrumentation logic in isolation
- Fast, no external dependencies

**Native Hook Tests** (`test/js/bun/telemetry/`):

- Test `Bun.telemetry.*` API directly
- Verify hooks called with correct data
- NO @opentelemetry/\* imports

**Integration Tests** (`test/integration/opentelemetry/`):

- Full end-to-end with real backends
- Docker Compose for Jaeger/Zipkin/OTLP
- Verify traces appear in backend UI

**Regression Test** (`packages/bun-otel/test/issue-3775.test.ts`):

- Reproduce exact scenario from GitHub issue #3775
- Verify `/v1/traces` endpoint receives data

**References**:

- Constitution Principle I (Test-First Development)
- Issue #3775 reproduction steps
- `/TELEMETRY_REFACTOR.md` testing approach

## Existing Implementation Lessons (from feat/opentelemetry-server-hooks)

### Test Strategy (Validated and Working)

**Core Tests** (`test/js/bun/telemetry*.test.ts`):

- Test ONLY that native hooks are called
- NO `@opentelemetry/*` imports allowed
- Verify callbacks receive correct arguments
- Ensure zero overhead when disabled

**Package Tests** (`packages/bun-otel/test/*.test.ts`):

- Test OpenTelemetry span creation and attributes
- Test W3C TraceContext propagation
- Test semantic conventions compliance
- Full OTel SDK integration testing

**Integration Tests** (planned):

- Standalone projects with Docker Compose backends
- End-to-end validation with Jaeger/Zipkin/OTLP

**Key Insight**: Clear separation prevents test contamination and allows independent evolution of native hooks vs OTel integration.

**References**:

- `/packages/bun-otel/TEST_STRATEGY.md` - Comprehensive test organization guide
- `/BRANCH_SUMMARY.md` lines 83-92 - Test file listing

### Development Lessons Learned

**1. Test Flakiness from Timing Dependencies**

**Problem**: Fixed `Bun.sleep()` delays caused intermittent test failures (20+ commits addressing this)

**Solution**: Deterministic polling with `waitForCondition()` helper:

```typescript
async function waitForCondition(
  check: () => boolean,
  timeout = 500,
  interval = 5,
): Promise<void> {
  const start = Date.now();
  while (!check() && Date.now() - start < timeout) {
    await Bun.sleep(interval);
  }
  if (!check()) throw new Error("Condition not met");
}
```

**Lesson**: Never use arbitrary sleeps in async tests - always wait for observable conditions

**2. Defensive Isolation is Critical**

**Problem**: Telemetry bugs crashed request handling

**Solution**: Wrap all telemetry calls in try/catch, use optional chaining, validate types

**Lesson**: Treat instrumentation as untrusted third-party code even when first-party

**3. Memory Management Patterns**

**Problem**: Multiple memory leaks (correlationHeaderNames buffer, protected JSValues not released)

**Solution**:

- TypeScript: Use `using` keyword for automatic resource cleanup
- Zig: Use `defer` for cleanup paths
- Always pair `protect()` with `unprotect()` for JSValues

**Lesson**: Memory leaks accumulate - use language features for deterministic cleanup

**4. Cross-Platform Normalization**

**Problem**: Bun.serve vs Node.js http subtle differences (status codes, headers, URL parsing)

**Solution**: Push platform differences to edges, normalize early in TypeScript layer

**Lesson**: Shared code paths reduce bugs - don't duplicate normalization logic in Zig

**5. Zero-Overhead When Disabled**

**Problem**: Early versions generated request IDs before checking if telemetry enabled

**Solution**:

- Early returns before any work
- Lazy initialization
- Pre-parse configuration at attach time, not per-request

**Lesson**: "Zero overhead when disabled" requires constant profiling and optimization

**6. OpenTelemetry Standards Compliance**

**Problem**: Custom attribute names didn't match semantic conventions

**Solution**: Replaced custom names with OTel standard attributes:

- `route` → `http.route`
- `user.id` → `enduser.id`
- Error status only for 5xx, not 4xx (per OTel guidance)

**Lesson**: Follow established standards - enables tool interoperability

**References**:

- `/BRANCH_SUMMARY.md` lines 11-32 - Lessons Learned section

### Existing File Inventory

**Core Runtime** (Zig):

- `src/bun.js/telemetry.zig` - Current configure() API (needs refactor)
- `src/bun.js/api/server/RequestContext.zig` - Bun.serve() integration
- `src/js/node/_http_server.ts` - Node.js http hooks

**TypeScript Package** (already implemented):

- `packages/bun-otel/bun-sdk.ts` - BunSDK wrapper around NodeSDK
- `packages/bun-otel/BunFetchInstrumentation.ts` - Fetch client instrumentation
- `packages/bun-otel/BunServerMetricsInstrumentation.ts` - HTTP server metrics
- `packages/bun-otel/BunAsyncLocalStorageContextManager.ts` - Context propagation workarounds
- `packages/bun-otel/test/*.test.ts` - 9 test files covering all features
- `packages/bun-otel/examples/*.ts` - Basic, advanced, Hono, Elysia examples

**Status**:

- ✅ P1 (HTTP Tracing): Implemented, working, needs refactor to attach/detach
- ✅ P2 (Metrics): Implemented (BunServerMetricsInstrumentation)
- ⚠️ P3 (Logging): Basic support via AsyncLocalStorage, needs formatters (pino/winston)

**References**:

- `/BRANCH_SUMMARY.md` lines 33-92 - Complete file listing

## Open Questions / Future Work

### Question: AsyncLocalStorage Full Compatibility

**Status**: Workaround implemented, tracking Bun improvements

Bun's AsyncLocalStorage doesn't propagate through `context.with()` calls. We've implemented a custom ContextManager workaround, but full compatibility would be ideal.

**Tracking**: Monitor Bun releases for AsyncLocalStorage improvements

### Question: Metrics Implementation Priority

**Status**: Defined as P2 in spec, defer to post-P1

HTTP metrics (request count, duration histograms) are valuable but not blocking for initial release. Focus P1 on distributed tracing.

**Decision**: Implement P1 (tracing) first, validate with users, then add P2 (metrics)

### Question: SQL/Redis/AWS Instrumentation Hooks

**Status**: Architecture supports, defer implementation

Native hooks designed to be generic (SQL, Redis, AWS). Implementation deferred to separate features post-P1.

**Decision**: Provide hook points in Zig, document extension pattern, implement when demand validates

## Conclusion

All architectural decisions documented. Working implementation exists in `feat/opentelemetry-server-hooks` branch. Ready for Phase 1 (data model and contracts design) to support refactor execution.

**Implementation Scope**:

1. **Refactor** (7-10 days): Move from `configure()` to `attach/detach` model per TELEMETRY_REFACTOR.md
2. **P3 Features** (2-3 days): Add Pino/Winston formatters to `packages/bun-otel/src/instruments/logging/`
3. **Integration Tests** (1-2 days): Create standalone Docker Compose tests for Jaeger/Zipkin/OTLP

**Key Takeaways**:

1. Native Zig hooks should provide 10x performance improvement (needs testing)
2. Bun core stays dependency-free; `@opentelemetry/*` in packages/bun-otel
3. Test strategy validated: core tests separate from OTel tests
4. Security-first header capture model
5. Refactor needed: configure() → attach/detach for extensibility
6. P3 incomplete: Need high-level logging formatters (low-level API exists)
7. Developer-friendly defaults (AlwaysOn sampling, safe header list)
