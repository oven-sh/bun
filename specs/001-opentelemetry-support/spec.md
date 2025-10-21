# Feature Specification: OpenTelemetry Support for Bun

**Feature Branch**: `001-opentelemetry-support`
**Created**: 2025-10-20
**Status**: Draft
**Input**: User description: "Bun support for OpenTelemetry Traces, Metrics, and Logs; functionally equivalent to the opentelemetry-js node package. Address github issue #3775"

## Clarifications

### Session 2025-10-20

- Q: When an exporter fails to send telemetry data (network error, backend unavailable), how should the system handle this failure? → A: Buffer failed batches with bounded retry (3 attempts with exponential backoff), then drop
- Q: When capturing HTTP request/response headers (FR-014), how should the system handle potentially sensitive data like authorization tokens, cookies, and PII? → A: Deny all by default with explicit allowlist configuration, but provide a safe default allowlist (content-type, user-agent, accept, content-length) when unspecified
- Q: Should existing OpenTelemetry instrumentation packages (like @opentelemetry/instrumentation-express, @opentelemetry/instrumentation-pg) work with Bun's implementation, or is this a Bun-native-only solution? → A: Bun-specific instrumentations (native or not) will be provided for each Bun-native package (http, sql, redis, s3, fetch) plus system metrics from packages/bun-otel - these MUST work. Drop-in compatibility for opentelemetry-js-contrib SHOULD work but will be tracked on a per-package basis (out of scope for this feature)
- Q: What should the default sampling strategy be for traces when developers don't explicitly configure one? → A: AlwaysOn (100% sampling) by default, configurable via the same mechanisms as opentelemetry-js (TracerProvider sampler configuration)
- Q: For the Structured Logging Integration (User Story 3 - P3), how should trace context be injected into log records? → A: Provide both high-level helpers/formatters (in BunSDK) for popular loggers (pino, winston) and low-level API (in Bun.telemetry) for manual extraction of trace context (getActiveSpan/trace IDs)
- Q: Should MeterProvider use native Zig implementation or standard OpenTelemetry TypeScript SDK? → A: Hybrid approach - native Zig instrumentation provides raw metric samples (memory, CPU, OS metrics, HTTP request count/times, fetch count/times) when enabled, but actual collection, aggregation, and sending handled by standard @opentelemetry/sdk-metrics in TypeScript
- Q: Which specific system metrics should native Zig instrumentation provide? → A: Focused runtime metrics: process memory (heap used, RSS), event loop lag, and GC statistics - metrics Bun runtime already tracks internally for high-value observability
- Q: How frequently should runtime metrics (memory, event loop lag, GC stats) be sampled from native layer? → A: Configurable poll interval passed during instrumentation attach() - onOperationProgress hook called on that interval after event loop flush, continues until instrumentation detached
- Q: Should runtime metrics instrumentation be enabled by default, or require explicit opt-in? → A: Follow NodeSDK configuration pattern - runtime metrics instrumentation enabled when BunSDK is configured with metricReaders (via explicit config or OTEL_METRICS_EXPORTER env var), using same reader configuration structure (periodic export interval, timeout, exporter settings) as NodeSDK
- Q: Which OpenTelemetry semantic conventions should be used for runtime metric naming (memory, event loop, GC)? → A: Use runtime-detected namespace based on process.release.name - if set to 'bun' use process.runtime.bun.* namespace, otherwise use process.runtime.nodejs.* for Node.js compatibility mode, following OpenTelemetry process runtime semantic conventions pattern

## User Scenarios & Testing _(mandatory)_

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.

  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - Distributed Tracing for HTTP Services (Priority: P1)

Developers building HTTP services with Bun can automatically capture distributed traces across their service architecture without monkey-patching or loader hooks.

**Why this priority**: This is the most critical use case preventing Bun adoption in production environments where observability is mandatory. Issue #3775 has 28 comments showing significant demand.

**Independent Test**: Can be fully tested by starting a Bun HTTP server with OpenTelemetry SDK configured, making requests, and verifying traces appear in a backend (Jaeger, Zipkin, or console exporter).

**Acceptance Scenarios**:

1. **Given** a Bun HTTP server using `Bun.serve()` with OpenTelemetry SDK configured, **When** a client makes an HTTP request, **Then** a trace span is automatically created with HTTP method, URL, status code, and timing information
2. **Given** an HTTP request with a `traceparent` header (W3C TraceContext), **When** the request is processed, **Then** the created span is linked as a child of the incoming trace context
3. **Given** a Bun application making outbound HTTP requests using `fetch()`, **When** those requests are made within an active trace context, **Then** trace context is propagated via `traceparent` header and spans are created for outbound requests
4. **Given** an HTTP request that results in an error, **When** the error occurs, **Then** the trace span captures the error details and marks the span as errored

---

### User Story 2 - Metrics Collection for Runtime and Application Performance (Priority: P2)

Developers can collect standard OpenTelemetry metrics about their Bun application's performance including HTTP request rates, durations, and custom business metrics.

**Why this priority**: Metrics provide aggregated performance data complementing traces. Critical for production monitoring but less urgent than basic tracing capability.

**Independent Test**: Can be tested by configuring metrics collection, running load tests, and verifying metric data exports to a metrics backend or console.

**Acceptance Scenarios**:

1. **Given** OpenTelemetry metrics SDK is configured, **When** HTTP requests are processed, **Then** standard HTTP server metrics are automatically collected (request count, request duration histogram, active requests gauge)
2. **Given** a developer defines custom metrics using OpenTelemetry API, **When** application code updates those metrics, **Then** metric data is correctly aggregated and exported
3. **Given** metrics are being collected, **When** the metrics export interval elapses, **Then** metrics are successfully exported to the configured backend

---

### User Story 3 - Structured Logging Integration (Priority: P3)

Developers can correlate application logs with traces by injecting trace context into log records using provided helpers or low-level APIs.

**Why this priority**: Logging integration enhances debugging by connecting logs to traces, but can be achieved manually if needed. Lower priority than core tracing and metrics.

**Independent Test**: Can be tested by making requests with tracing enabled and verifying that log entries include trace ID and span ID fields when using provided formatters or manual API calls.

**Acceptance Scenarios**:

1. **Given** a developer uses BunSDK logger helpers with pino or winston, **When** application code emits log messages within an active trace context, **Then** log records automatically include trace ID and span ID
2. **Given** a developer uses low-level Bun.telemetry API, **When** they call getActiveSpan() during logging, **Then** they can manually extract and include trace context in their log records
3. **Given** logs with trace context are being collected, **When** the log export interval elapses, **Then** log records are successfully exported to the configured backend with trace context preserved

---

### Edge Cases

- What happens when OpenTelemetry SDK is configured but no exporter is provided? System should handle gracefully without affecting application performance.
- How does the system handle high request volumes (10,000+ RPS)? Instrumentation overhead should remain minimal (less than 5 percent performance impact).
- What happens when trace context headers are malformed? System should handle invalid headers gracefully without breaking request processing.
- How are async operations (timers, promises) handled in trace context propagation? Context should propagate correctly through Bun's async primitives.
- What happens when multiple instrumentations are registered for the same operation type? All registered instrumentations should receive hooks in registration order.
- What happens when an exporter fails to send telemetry data due to network errors or backend unavailability? System buffers failed batches with bounded retry (3 attempts with exponential backoff), then drops data to prevent memory exhaustion while maintaining application stability.
- How are sensitive headers (authorization, cookies, api-keys) handled during capture? System uses deny-by-default security model - only explicitly allowlisted headers are captured. Default allowlist includes safe headers (content-type, user-agent, accept, content-length) and excludes all authentication/session/PII headers.
- What is the default sampling strategy when developers don't configure one explicitly? AlwaysOn (100% sampling) by default to ensure traces appear during initial setup and development, configurable using standard opentelemetry-js TracerProvider sampler configuration for production tuning.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST provide automatic HTTP server span creation for both `Bun.serve()` and Node.js `http` module compatibility layer
- **FR-002**: System MUST support W3C TraceContext propagation (traceparent and tracestate headers) for distributed tracing
- **FR-003**: System MUST provide automatic HTTP client span creation for `fetch()` requests
- **FR-004**: System MUST support standard OpenTelemetry semantic conventions for HTTP spans (method, URL, status code, user agent)
- **FR-005**: System MUST allow developers to configure trace exporters (OTLP, Jaeger, Zipkin, Console)
- **FR-006**: System MUST provide raw metric samples from native instrumentation for HTTP operations (request count, request duration, active requests) and fetch operations (client request count, duration), feeding data to standard @opentelemetry/sdk-metrics MeterProvider for aggregation and export
- **FR-007**: System MUST provide raw metric samples from native Zig layer for runtime metrics (process memory heap used, process memory RSS, event loop lag, GC statistics) via onOperationProgress hook called on configurable poll interval (passed during attach), triggered after event loop flush, using runtime-detected namespace (process.runtime.bun.* if process.release.name === 'bun', otherwise process.runtime.nodejs.* for Node.js compatibility), with collection/aggregation handled by @opentelemetry/sdk-metrics in TypeScript
- **FR-008**: System MUST allow developers to create custom metrics using standard OpenTelemetry Metrics API (@opentelemetry/api)
- **FR-009**: System MUST support metric exporters compatible with OpenTelemetry protocol via standard @opentelemetry/sdk-metrics, following NodeSDK configuration pattern (metricReaders array with periodic export interval, timeout, and exporter settings)
- **FR-010**: System MUST provide log correlation by injecting trace context into log records
- **FR-011**: System MUST support multiple simultaneous instrumentations via attach/detach API
- **FR-012**: System MUST achieve functional equivalence with `@opentelemetry/sdk-node` for HTTP tracing
- **FR-013**: System MUST provide zero-cost abstraction when telemetry is disabled (no performance impact)
- **FR-014**: System MUST support B3, Jaeger, and W3C Baggage propagation formats in addition to W3C TraceContext
- **FR-015**: System MUST allow configuration of request/response header capture with explicit allowlist (deny-by-default security model), providing safe defaults (content-type, user-agent, accept, content-length) when no custom allowlist specified
- **FR-016**: System MUST support error tracking with automatic span status marking and error recording
- **FR-017**: System MUST implement bounded retry with exponential backoff (3 attempts) for failed telemetry exports, dropping data after retry exhaustion to prevent memory buildup
- **FR-018**: System MUST provide Bun-specific instrumentations via packages/bun-otel for Bun-native APIs (http, fetch, sql, redis, s3) and system metrics, with standard OpenTelemetry API compatibility for manual instrumentation
- **FR-019**: System MUST default to AlwaysOn (100%) sampling strategy, supporting configuration via standard opentelemetry-js TracerProvider sampler mechanisms (AlwaysOff, AlwaysOn, ParentBased, Probabilistic)
- **FR-020**: System MUST provide both high-level logger integration helpers (BunSDK formatters for pino/winston) and low-level trace context access API (Bun.telemetry.getActiveSpan()) for log correlation

### Key Entities _(include if feature involves data)_

- **Trace Span**: Represents a single operation in a distributed trace with timing, attributes, and relationships to parent/child spans
- **Trace Context**: Propagated context containing trace ID, span ID, and trace flags used to link distributed operations
- **Metric**: Aggregated measurement of application behavior (counter, histogram, gauge) with dimensions/labels. Native instrumentation provides raw samples for HTTP/fetch operations (request count, duration, active requests) and runtime health (process memory heap/RSS, event loop lag, GC stats); standard @opentelemetry/sdk-metrics handles aggregation and export
- **Log Record**: Structured log entry with severity, message, timestamp, and optional trace correlation
- **Instrumentation**: Registered component that hooks into native operations to create telemetry data
- **Exporter**: Component responsible for sending telemetry data to backend systems (OTLP, Jaeger, Zipkin, etc.)
- **Resource**: Metadata describing the entity producing telemetry (service name, version, host, etc.)

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Developers can set up distributed tracing in under 10 lines of configuration code without loader hooks or monkey-patching
- **SC-002**: HTTP server traces are successfully exported to standard OpenTelemetry backends (Jaeger, Zipkin, OTLP collectors) with 100 percent of critical HTTP attributes present
- **SC-003**: Instrumentation overhead is less than 5 percent latency increase for HTTP request processing compared to uninstrumented baseline
- **SC-004**: When telemetry is disabled, performance impact is unmeasurable (less than 0.1 percent overhead)
- **SC-005**: Applications using `@opentelemetry/sdk-node` can migrate to Bun with less than 20 lines of code changes to achieve equivalent tracing functionality by importing a `bun-otel` native/integrated package
- **SC-006**: Trace context propagates correctly through at least 10 hops in a distributed system without data loss
- **SC-007**: System maintains stability under sustained load of 10,000+ requests per second with tracing enabled
- **SC-008**: Custom metrics and traces can be created and exported alongside automatic instrumentation without conflicts
- **SC-009**: Issue #3775 reproduction scenario works without errors (test-server receives /v1/traces requests)
- **SC-010**: Examples from `https://opentelemetry.io/docs/languages/js/getting-started/nodejs/` work out of the box, with the correct import

## Assumptions

- OpenTelemetry SDK packages (`@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, etc.) are available and can be used from Bun with Node.js compatibility
- Developers are familiar with OpenTelemetry concepts (spans, traces, exporters, propagators)
- Standard OTLP (OpenTelemetry Protocol) over HTTP/gRPC is the primary export mechanism
- Bun's `AsyncLocalStorage` implementation is sufficient for context propagation (with documented workarounds if needed)
- Native telemetry hooks at the Zig layer can provide 10x performance improvement over monkey-patching approaches
- The existing work in `feat/opentelemetry-server-hooks` branch provides a foundation to build upon
- Framework-specific integrations (Hono, Elysia) can be added as separate instrumentations using the attach/detach API

## Dependencies

- Completion of native telemetry attach/detach API refactor (as documented in TELEMETRY_REFACTOR.md)
- OpenTelemetry JavaScript packages must work correctly in Bun's Node.js compatibility mode
- Any AsyncLocalStorage limitations in Bun must be documented with workarounds

## Out of Scope

- Database instrumentation (SQL, Redis, MongoDB) - covered in separate features, but hooks will be provided
- AWS SDK instrumentation (S3, DynamoDB, SQS) - covered in separate features, but hooks will be provided
- Browser/client-side telemetry - Bun is server-side runtime
- Custom sampling strategies beyond OpenTelemetry SDK defaults
- Proprietary tracing formats (only OpenTelemetry-compatible backends)
- Performance profiling or continuous profiling features
- Guaranteed compatibility with all opentelemetry-js-contrib instrumentation packages - best-effort compatibility, tracked per-package separately

## Appendix

- `REF_BUN_ZIG_CALLBAC_PATTERNS.md` : Research for when calling bun ts <--> zig
