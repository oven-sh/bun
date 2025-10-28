# OpenTelemetry Support for Bun - Design Specification

**Status**: Implementation Complete
**Created**: 2025-10-20
**Last Updated**: 2025-10-24

---

## Introduction

This PR adds `Bun.telemetry` and a `bun-otel` package with a Bun-specific implementation of [OpenTelemetry](https://opentelemetry.io) for `Bun.serve()` (and `Node.js http.createServer()`!), addressing issue #3775 where the native server did not work with `AsyncLocalStorage` for context propagation.

In addition, this provides a foundation for moving to full compatibility with auto instrumentation, as well as manual configuration via a `BunSDK` helper that tracks the `NodeSDK` utility's API. In the spirit of Bun's performance advantage, we've added native instrumentation hooks at each Bun-native replacement: `Bun.serve`, `fetch`, and more.

This is a significant API evolution from the POC. The POC used a configure-based API with request callbacks, while the current spec uses an attach/detach pattern with operation-centric callbacks and explicit InstrumentKind types.

---

## Goals and User Stories

### User Story 1: Distributed Tracing for HTTP Services (P1)

Developers building HTTP services with Bun can automatically capture distributed traces across their service architecture without monkey-patching or loader hooks.

**Why P1**: This is the most critical use case preventing Bun adoption in production environments where observability is mandatory. Issue #3775 has 28 comments showing significant demand.

**Key Capabilities**:

- Automatic HTTP server span creation for `Bun.serve()` and Node.js `http.createServer()`
- W3C TraceContext propagation (traceparent/tracestate headers)
- Automatic HTTP client span creation for `fetch()` requests
- Error tracking with span status marking

### User Story 2: Metrics Collection for Runtime and Application Performance (P2)

Developers can collect standard OpenTelemetry metrics about their Bun application's performance including HTTP request rates, durations, runtime health, and custom business metrics.

**Why P2**: Metrics provide aggregated performance data complementing traces. Critical for production monitoring but less urgent than basic tracing capability.

**Key Capabilities**:

- HTTP request metrics (count, duration histogram, active requests)
- Runtime metrics (process memory, event loop lag, GC statistics)
- Custom metrics via OpenTelemetry API

### User Story 3: Structured Logging Integration (P3)

Developers can correlate application logs with traces by injecting trace context into log records using provided helpers or low-level APIs.

**Why P3**: Logging integration enhances debugging by connecting logs to traces, but can be achieved manually if needed. Lower priority than core tracing and metrics.

---

## Functional Requirements

### HTTP Tracing

- **FR-001**: System MUST provide automatic HTTP server span creation for both `Bun.serve()` and Node.js `http` module compatibility layer
- **FR-002**: System MUST support W3C TraceContext propagation (traceparent and tracestate headers) for distributed tracing
- **FR-003**: System MUST provide automatic HTTP client span creation for `fetch()` requests
- **FR-004**: System MUST support standard OpenTelemetry semantic conventions for HTTP spans (method, URL, status code, user agent)
- **FR-005**: System MUST allow developers to configure trace exporters (OTLP, Jaeger, Zipkin, Console)
- **FR-014**: System MUST support B3, Jaeger, and W3C Baggage propagation formats in addition to W3C TraceContext
- **FR-015**: System MUST allow configuration of request/response header capture with explicit allowlist (deny-by-default security model), providing safe defaults (content-type, user-agent, accept, content-length) when no custom allowlist specified
- **FR-016**: System MUST support error tracking with automatic span status marking and error recording

### Metrics Collection

- **FR-006**: System MUST provide raw metric samples from native instrumentation for HTTP operations (request count, request duration, active requests) and fetch operations (client request count, duration), feeding data to standard @opentelemetry/sdk-metrics MeterProvider for aggregation and export
- **FR-007**: System MUST provide runtime metrics (process memory heap used, process memory RSS, event loop lag, GC statistics) with configurable collection intervals, using runtime-detected namespace (process.runtime.bun.\_ if process.release.name === 'bun', otherwise process.runtime.nodejs.\_ for Node.js compatibility mode), with collection/aggregation handled by @opentelemetry/sdk-metrics in TypeScript
- **FR-008**: System MUST allow developers to create custom metrics using standard OpenTelemetry Metrics API (@opentelemetry/api)
- **FR-009**: System MUST support metric exporters compatible with OpenTelemetry protocol via standard @opentelemetry/sdk-metrics, following NodeSDK configuration pattern (metricReaders array with periodic export interval, timeout, and exporter settings)

### Logging Integration

- **FR-010**: System MUST provide log correlation by injecting trace context into log records
- **FR-020**: System MUST provide both high-level logger integration helpers (provided by `packages/bun-otel` instrumentation package for pino/winston) and low-level trace context access API (provided by native `Bun.telemetry.getActiveSpan()`) for log correlation

### Instrumentation and Configuration

- **FR-011**: System MUST support multiple simultaneous instrumentations via attach/detach API
- **FR-012**: System MUST achieve functional equivalence with `@opentelemetry/sdk-node` for HTTP tracing
- **FR-013**: System MUST provide zero-cost abstraction when telemetry is disabled (no performance impact)
- **FR-018**: System MUST provide Bun-specific instrumentations via packages/bun-otel for Bun-native APIs (http, fetch, sql, redis, s3) and system metrics, with standard OpenTelemetry API compatibility for manual instrumentation
- **FR-019**: System MUST default to AlwaysOn (100%) sampling strategy, supporting configuration via standard opentelemetry-js TracerProvider sampler mechanisms (AlwaysOff, AlwaysOn, ParentBased, Probabilistic)
- **FR-021**: System MUST determine resource attributes (service.name, service.version, deployment.environment) using standard OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES environment variables, with fallback to package.json (name and version fields)

### Error Handling and Reliability

- **FR-017**: System MUST implement bounded retry with exponential backoff (3 attempts) for failed telemetry exports, dropping data after retry exhaustion to prevent memory buildup
- **FR-022**: System MUST implement defensive error handling for instrumentation hook exceptions - catch exceptions, log to stderr with rate limiting to prevent log flooding, clear exception state, and continue request processing normally without affecting application behavior
- **FR-023**: System MUST enforce header validation rules (lowercase strings only, maximum 50 headers per list, sensitive headers always blocked, invalid headers logged and ignored non-fatally) to prevent data leakage and denial-of-service attacks
- **FR-024**: System MUST minimize memory allocations in telemetry hooks to ensure predictable performance characteristics

### Telemetry Context API

- **FR-029**: Header injection MUST support synchronous response from TypeScript (no async allowed at this layer)
- **FR-032**: Operation IDs (OpId/u64) MUST be monotonic and never reused within process lifetime
- **FR-034**: `init()` and `attach()` MUST raise global error on invalid configuration
- **FR-035**: `notifyOperation*` functions MUST silently fail on OOM (no errors to caller)
- **FR-036**: `enabled()` MUST return null if initialization failed (never throws)
- **FR-037**: All telemetry operations MUST be thread-safe: `enabled()` uses atomic read, `generateId()` uses atomic increment, `notifyOperation*` functions have safe concurrent access, AttributeKeys singleton is immutable after initialization

### ShadowRealm and GlobalObject Support

- **FR-038**: TelemetryContext MUST support independent JavaScript realm contexts (including shadowRealms)
- **FR-039**: Instrumentation MAY run in a different realm than the execution context
- **FR-040**: AttributeMap MUST store primitive JSValues (strings, numbers) which CAN be passed between realm contexts within the same VM
- **FR-041**: AttributeMap MUST NOT store object JSValues that cannot cross realm boundaries
- **FR-042**: The first call to `Bun.telemetry.attach()` MUST capture the caller's GlobalObject context for all subsequent telemetry operations
- **FR-043**: All telemetry operations (AttributeMap allocations, callback invocations, context management) MUST use the captured GlobalObject from the initial `attach()` call
- **FR-044**: Subsequent `attach()` calls from a DIFFERENT GlobalObject in the same VM MUST throw an error: "Telemetry already bound to a different realm"
- **FR-045**: Subsequent `attach()` calls from the SAME GlobalObject MUST succeed and register the additional instrument
- **FR-046**: When telemetry is disabled via configuration OR when all instruments are removed (last `detach()` call), the GlobalObject binding MUST be reset, allowing a new `attach()` from a different realm to succeed

---

## Implementation Constraints

### Performance Constraints

#### Zero-Cost Abstraction When Disabled

- **CON-001**: `enabled()` check MUST be inlined and compile to single boolean check
- **CON-002**: Instrumentation blocks in the hot-path MUST be the shortest canonical representation of the necessary functionality
- **CON-003**: `notifyOperation*` functions MUST be inline functions (zero call overhead)
- **CON-004**: AttributeMap operations MUST NOT allocate when telemetry disabled

**Rationale**: These constraints ensure SC-004 (<0.1% overhead when disabled) is achievable through compiler optimizations rather than runtime checks.

#### Minimal Allocation Strategy

- **CON-005**: All memory allocations in telemetry native hooks MUST be annotated with `// TODO OTEL_MALLOC - REVIEW` unless explicitly justified with human-reviewed `// OTEL_MALLOC - <reason>` comments
- **CON-006**: TelemetryContext returned by `enabled()` MUST NOT require cleanup (no deinit)
- **CON-007**: AttributeMap created by `createAttributeMap()` MUST be stack-allocated and not require cleanup
- **CON-008**: AttributeMap passed to `notifyOperation*` methods MUST remain valid for the duration of the call only (no ownership transfer)

**Rationale**: Minimizing allocations and managing memory predictably ensures low overhead (SC-003) and prevents memory leaks or fragmentation under high load.

#### Synchronous Operation Requirements

- **CON-009**: Header injection MUST support synchronous response from TypeScript (no async allowed at this layer)

**Rationale**: Async operations in the hot path would add significant latency and complexity. Synchronous operations keep the request processing pipeline predictable.

### Memory Management Constraints

#### Operation Identity Management

- **CON-010**: Operation IDs (OpId/u64) MUST be monotonic and never reused within process lifetime

**Rationale**: Monotonic IDs prevent confusion when correlating async operations and ensure proper parent-child span relationships without requiring complex ID recycling logic.

### Error Handling Constraints

#### Configuration and Initialization

- **CON-011**: `init()` and `attach()` MUST raise global error on invalid configuration
- **CON-012**: `enabled()` MUST return null if initialization failed (never throws)

**Rationale**: Fail-fast at startup ensures configuration errors are caught early, but runtime checks must be safe to prevent crashing production applications.

#### Runtime Error Handling

- **CON-013**: `notifyOperation*` functions MUST silently fail on OOM (no errors to caller)

**Rationale**: Telemetry failures should never impact application behavior. Silent failure with potential data loss is preferable to application crashes.

### Thread Safety Constraints

- **CON-014**: All telemetry operations MUST be thread-safe:
  - `enabled()` uses atomic read
  - `generateId()` uses atomic increment
  - `notifyOperation*` functions have safe concurrent access
  - AttributeKeys singleton is immutable after initialization

**Rationale**: Bun supports worker threads and concurrent operations. Thread safety prevents data races and ensures correct operation in multi-threaded environments.

### ShadowRealm Support Constraints

#### Realm Isolation

- **CON-015**: TelemetryContext MUST support independent JavaScript realm contexts (including shadowRealms)
- **CON-016**: Instrumentation MAY run in a different realm than the execution context

**Rationale**: ShadowRealms are a JavaScript feature for isolated execution contexts. Supporting them ensures telemetry works in complex application architectures.

#### Data Transfer Between Realms

- **CON-017**: AttributeMap MUST store primitive JSValues (strings, numbers) which CAN be passed between realm contexts within the same VM
- **CON-018**: AttributeMap MUST NOT store object JSValues that cannot cross realm boundaries

**Rationale**: Objects cannot be safely shared between realms. Restricting to primitives ensures data can flow between realms without serialization overhead.

### GlobalObject Binding Constraints

#### Realm Binding Rules

- **CON-019**: The first call to `Bun.telemetry.attach()` MUST capture the caller's GlobalObject context for all subsequent telemetry operations
- **CON-020**: All telemetry operations (AttributeMap allocations, callback invocations, context management) MUST use the captured GlobalObject from the initial `attach()` call
- **CON-021**: Subsequent `attach()` calls from a DIFFERENT GlobalObject in the same VM MUST throw an error: "Telemetry already bound to a different realm"
- **CON-022**: Subsequent `attach()` calls from the SAME GlobalObject MUST succeed and register the additional instrument
- **CON-023**: When telemetry is disabled via configuration OR when all instruments are removed (last `detach()` call), the GlobalObject binding MUST be reset, allowing a new `attach()` from a different realm to succeed

**Rationale**: These constraints prevent complex bugs from mixing realm contexts while allowing legitimate multi-instrumentation scenarios. The binding reset on full detach enables testing and reconfiguration scenarios.

### Package Architecture Constraints

#### Instrumentation Code Location

- **CON-024**: TypeScript instrumentation code for OpenTelemetry integration MUST be located in user-loadable packages (e.g., `packages/bun-otel`), NOT in internal runtime modules (e.g., `src/js/internal/`)
- **CON-025**: Internal runtime modules (e.g., `src/js/node/_http_server.ts`) MUST call native `Bun.telemetry` hooks directly without requiring intermediate TypeScript bridge modules
- **CON-026**: Instrumentation packages MUST only load when explicitly imported by user code to ensure zero startup cost for applications not using telemetry

**Rationale**: This ensures CON-001 and CON-002 are achievable. Internal modules load on every startup (when their API is used), adding parsing and memory overhead even when telemetry is disabled. User-loadable packages only load when explicitly imported, ensuring true zero cost for non-telemetry applications.

#### TypeScript to Native Integration

- **CON-027**: Instrumentation packages MAY import OpenTelemetry npm packages (e.g., `@opentelemetry/api`, `@opentelemetry/semantic-conventions`) to access official constants and types
- **CON-028**: Internal runtime modules MUST NOT import npm packages, preventing duplication of constants and ensuring they remain lightweight

**Rationale**: Instrumentation packages need access to official OpenTelemetry constants and utilities to ensure spec compliance. Internal modules cannot import npm packages without bloating the runtime.

#### Code Sharing Between HTTP Implementations

- **CON-029**: A single instrumentation class (e.g., `BunHttpInstrumentation`) SHOULD handle both native `Bun.serve()` and Node.js `http.createServer()` telemetry hooks to maximize code reuse
- **CON-030**: The instrumentation receives operation callbacks from the native layer with sufficient context (request/response objects) to extract all required semantic convention attributes for both HTTP server implementations

**Rationale**: Sharing code reduces maintenance burden and ensures consistent behavior across HTTP implementations while keeping the instrumentation package size manageable.

---

## Key Design Decisions

### Header Capture Security Model

**Decision**: Deny-by-default with explicit allowlist for header capture.

- Only headers explicitly allowlisted are captured for telemetry
- Default allowlist includes only safe headers: `content-type`, `content-length`, `user-agent`, `accept`
- Sensitive headers (authorization, cookie, x-api-key, etc.) are ALWAYS blocked even if allowlisted
- Maximum 50 headers per list to prevent DoS attacks
- Invalid headers logged and ignored (non-fatal)

**Rationale**: Security must be default-safe. Telemetry should not accidentally leak credentials or PII. Users must consciously opt-in to capture specific headers.

### Sampling Strategy Defaults

**Decision**: AlwaysOn (100% sampling) by default, configurable via standard OpenTelemetry mechanisms.

- Default 100% sampling ensures traces appear during initial setup and development
- Production tuning available via TracerProvider sampler configuration
- Supports AlwaysOff, AlwaysOn, ParentBased, and Probabilistic samplers

**Rationale**: Developer experience is prioritized - traces should "just work" when first configured. Production users can tune sampling rates based on volume.

### Metrics Architecture (Hybrid Zig/TypeScript)

**Decision**: Native Zig instrumentation provides raw metric samples; standard @opentelemetry/sdk-metrics handles aggregation and export.

- Native layer emits raw samples for HTTP operations (count, duration) and runtime metrics (memory, event loop lag, GC stats)
- TypeScript SDK aggregates samples into histograms, counters, and gauges
- Export handled by standard OpenTelemetry exporters

**Rationale**: Native instrumentation minimizes overhead for data collection. Reusing standard SDK ensures compatibility with OpenTelemetry ecosystem and avoids reimplementing complex aggregation logic.

### Resource Attribute Determination

**Decision**: Use standard OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES environment variables, with fallback to package.json.

- Follows OpenTelemetry conventions for resource configuration
- Automatic fallback to `package.json` fields (`name`, `version`) for convenience
- Deployment environment configurable via OTEL_RESOURCE_ATTRIBUTES

**Rationale**: Standardization enables drop-in compatibility with existing OpenTelemetry tooling and documentation. Fallback to package.json provides good defaults without requiring configuration.

### Runtime Metrics Namespace

**Decision**: Use runtime-detected namespace based on `process.release.name`.

- If `process.release.name === 'bun'`: use `process.runtime.bun.*` namespace
- Otherwise: use `process.runtime.nodejs.*` for Node.js compatibility mode

**Rationale**: Follows OpenTelemetry semantic conventions for process runtime metrics. Enables differentiation between native Bun and Node.js compatibility mode in multi-runtime environments.

### Error Handling Philosophy

**Decision**: Defensive isolation - instrumentation errors must never crash the runtime.

- Hooks wrapped in error handlers at the Zig layer
- Errors logged to stderr with rate limiting (10 messages/second)
- Request processing continues normally after hook errors
- Other instruments still invoked even if one fails

**Rationale**: Telemetry is auxiliary functionality. Application reliability must never be compromised by observability tooling bugs or misconfigurations.

### Node.js http.createServer() Integration

**Decision**: Node.js HTTP compatibility layer calls `Bun.telemetry` native hooks directly at key lifecycle points.

- TypeScript instrumentation packages register via `Bun.telemetry.attach()` to receive hooks
- No internal TypeScript bridge module required
- Instrumentation lives in user-loadable packages (`bun-otel`)

**Rationale**: Minimal insertion points in internal modules keep code maintainable. All complexity (span creation, context propagation) handled in optional packages. Zero cost when not imported.

### Exporter Failure Handling

**Decision**: Bounded retry with exponential backoff (3 attempts), then drop data.

- Failed exports retried up to 3 times with exponential backoff
- After retry exhaustion, data is dropped to prevent memory buildup
- Memory buffer capped at 100MB (configurable)

**Rationale**: Prevents memory exhaustion when telemetry backend is unavailable. Application stability prioritized over telemetry data completeness.

---

## Security Model

The telemetry system implements defense-in-depth security measures:

### Deny-by-Default Header Capture

- Only explicitly allowlisted headers are captured for telemetry
- Default allowlist: `content-type`, `content-length`, `user-agent`, `accept`
- Sensitive headers ALWAYS blocked: `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `x-csrf-token`, and any header matching patterns `*-token`, `*-key`, `*-secret`, `*-password`

### Header Validation Rules

- All header names must be lowercase strings (mixed-case/uppercase rejected)
- Maximum 50 headers per allowlist (DoS prevention)
- Invalid headers logged with rate limiting and gracefully ignored (non-fatal)
- Character validation: header names must match RFC 9110 field-name requirements

### Trace Context Security

- Incoming `traceparent`/`tracestate` headers validated against W3C TraceContext specification
- Malformed headers logged and ignored without breaking request processing
- Invalid trace/span IDs rejected (must be valid hex strings of correct length)
- Maximum 10 trace context headers injected per request/response
- Total injected header size capped at 8KB

### Rate Limiting and DoS Prevention

- Telemetry error logging rate-limited to 10 messages/second
- Failed export buffer capped at 100MB (configurable) before data is dropped
- Maximum 50 headers per capture list

---

## Success Criteria

- **SC-001**: Developers can set up distributed tracing in under 10 lines of configuration code without loader hooks or monkey-patching
- **SC-002**: HTTP server traces are successfully exported to standard OpenTelemetry backends (Jaeger, Zipkin, OTLP collectors) with 100 percent of critical HTTP attributes present
- **SC-003**: Instrumentation overhead is less than 5 percent latency increase for HTTP request processing compared to uninstrumented baseline (measured using oha or bombardier load testing tools per Bun benchmarking standards)
- **SC-004**: When telemetry is disabled, performance impact is unmeasurable (less than 0.1 percent overhead, measured using oha or bombardier)
- **SC-005**: Applications using `@opentelemetry/sdk-node` can migrate to Bun with less than 20 lines of code changes to achieve equivalent tracing functionality by importing a `bun-otel` native/integrated package
- **SC-006**: Trace context propagates correctly through at least 10 hops in a distributed system without data loss
- **SC-007**: System maintains stability under sustained load of 10,000+ requests per second with tracing enabled
- **SC-008**: Custom metrics and traces can be created and exported alongside automatic instrumentation without conflicts
- **SC-009**: Issue #3775 reproduction scenario works without errors (test-server receives /v1/traces requests)
- **SC-010**: Examples from `https://opentelemetry.io/docs/languages/js/getting-started/nodejs/` work out of the box, with the correct import

---

## Architectural Decisions

### ADR-001: Telemetry API Design Decisions

**Key Decisions**:

1. **Defensive Isolation for Hook Errors**: Errors in instrumentation hooks must not crash the Bun runtime. Hooks are wrapped in error handlers at the Zig layer, errors logged to stderr with context, and request processing continues normally. Third-party instrumentation bugs cannot impact application reliability.

2. **Reference Counting for JavaScript Objects**: Use protect/unprotect reference counting for JSValues held by Zig. The JavaScript garbage collector doesn't know about Zig references, so objects could be GC'd while Zig still holds pointers. Approximately 96 bytes overhead per instrument (6 protected values × 16 bytes), with deterministic cleanup on detach.

3. **Deny-By-Default Header Capture Security**: Only explicitly allowlisted headers are captured, with sensitive headers (authorization, cookie, x-api-key, etc.) always blocked. Default capture list includes only safe headers. Maximum 50 headers per list for DoS prevention, and all headers must be lowercase strings.

### ADR-002: Hook Lifecycle and Attribute Design

**Key Decisions**:

1. **Semantic Convention Attributes Only**: The Zig layer produces OpenTelemetry semantic convention attributes directly (http.request.method, url.path, etc.). TypeScript consumes them without translation via `span.setAttributes(attributes)`. This avoids custom object formats, reduces coupling, and improves interoperability with the OpenTelemetry ecosystem.

2. **Hook Signature Consistency**: All hooks receive `(id: number, attributes: Record<string, any>)` parameters. Consistent API across all hook types simplifies the mental model for instrumentation authors. Operation ID enables correlation across hooks, and attributes provide all necessary context.

3. **Error vs End Separation**: Separate `onOperationEnd` (success) and `onOperationError` (failure) hooks provide clear distinction between success and failure paths. Different attributes are available in error cases, aligning with OpenTelemetry span status model and simplifying instrumentation logic.

### ADR-003: Type Definition Location and API Surface Design

**Key Decisions**:

1. **Type Definitions Split Across Two Packages**: Public API types live in `packages/bun-types/telemetry.d.ts` (available to all Bun users), while internal SDK types live in `packages/bun-otel/types.ts` (not exported). This enables custom instrumentation implementations without forcing dependency on bun-otel, while keeping internal APIs encapsulated.

2. **String-Based Public API**: Public API uses ergonomic string literals (`kind: "http"`) for better developer experience. The Zig runtime handles conversion to internal numeric representation as an implementation detail, keeping the public API clean and self-documenting.

3. **Encapsulation of Internal APIs**: The `nativeHooks` namespace is excluded from public types - it's an implementation detail only needed by bun-otel TypeScript bridges. Users don't see confusing internal APIs in autocomplete, and the team has freedom to refactor internal bridge architecture without affecting public API stability.

### ADR-004: Instrumentation Package Architecture

**Key Decisions**:

1. **Instrumentation Code Lives in User-Loadable Packages**: TypeScript instrumentation code for OpenTelemetry integration is located in `packages/bun-otel/`, NOT in internal runtime modules (`src/js/internal/`). Internal modules load on every startup (adding ~0.5-1ms parsing overhead and ~5-15KB memory), violating zero-cost abstraction. User-loadable packages only load when explicitly imported, achieving true zero cost for non-telemetry applications.

2. **Internal Modules Call Native Hooks Directly**: Internal runtime modules (`src/js/node/_http_server.ts`) call native `Bun.telemetry` hooks directly without intermediate TypeScript bridges. Only 2 insertion points needed, with all complexity (span creation, context propagation, attribute mapping) handled in optional packages. Native functions are no-ops when telemetry disabled (compiler optimization).

3. **Package Can Import OpenTelemetry Packages**: Instrumentation packages import official OpenTelemetry npm packages (`@opentelemetry/api`, `@opentelemetry/semantic-conventions`) to access semantic convention constants, type definitions, and utilities. This eliminates constant duplication risk and ensures spec compliance. Official packages are peer dependencies, allowing users to control versions.

---

## Assumptions

- OpenTelemetry SDK packages (`@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, etc.) are available and can be used from Bun with Node.js compatibility
- Developers are familiar with OpenTelemetry concepts (spans, traces, exporters, propagators)
- Standard OTLP (OpenTelemetry Protocol) over HTTP/gRPC is the primary export mechanism
- Bun's `AsyncLocalStorage` implementation is sufficient for context propagation
- Native telemetry hooks at the Zig layer provide performance advantages over monkey-patching approaches
- Framework-specific integrations (Hono, Elysia) can be added as separate instrumentations using the attach/detach API

---

## Dependencies

- Completion of native telemetry attach/detach API in Zig layer
- OpenTelemetry JavaScript packages must work correctly in Bun's Node.js compatibility mode
- Any AsyncLocalStorage limitations in Bun must be documented with workarounds

---

## Out of Scope

- Database instrumentation (SQL, Redis, MongoDB) - hooks provided, but instrumentation packages not included in this feature
- AWS SDK instrumentation (S3, DynamoDB, SQS) - hooks provided, but instrumentation packages not included in this feature
- Browser/client-side telemetry - Bun is server-side runtime
- Custom sampling strategies beyond OpenTelemetry SDK defaults
- Proprietary tracing formats (only OpenTelemetry-compatible backends)
- Performance profiling or continuous profiling features
- Guaranteed compatibility with all opentelemetry-js-contrib instrumentation packages - best-effort compatibility, tracked per-package separately
