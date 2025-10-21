# Tasks: OpenTelemetry Support for Bun

**Input**: Design documents from `/specs/001-opentelemetry-support/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/
**Feature**: Native OpenTelemetry distributed tracing, metrics, and logging for Bun runtime

**Organization**: Tasks are grouped by user story (P1: Distributed Tracing, P2: Metrics, P3: Logging) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, basic structure, and type definitions

- [ ] T001 Create packages/bun-otel/ directory structure with src/, test/, examples/ subdirectories
- [ ] T002 [P] Initialize packages/bun-otel/package.json with OpenTelemetry dependencies (@opentelemetry/api ^1.9.0, @opentelemetry/sdk-trace-base ^1.30.0, @opentelemetry/sdk-metrics ^1.30.0, @opentelemetry/resources ^1.30.0, @opentelemetry/semantic-conventions ^1.30.0)
- [ ] T003 [P] Configure packages/bun-otel/tsconfig.json for ESM/CJS dual output
- [ ] T004 [P] Create packages/bun-otel/.gitignore for build artifacts
- [ ] T005 [P] Add InstrumentKind enum TypeScript definition in packages/bun-otel/src/types.ts
- [ ] T006 [P] Add NativeInstrument interface TypeScript definition in packages/bun-otel/src/types.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core native infrastructure that MUST be complete before ANY user story implementation

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. This phase implements the refactor from monolithic configure() to extensible attach/detach model.

### Native Runtime Core (Zig)

- [ ] T007 Refactor src/bun.js/telemetry.zig to replace configure() API with attach/detach model per TELEMETRY_REFACTOR.md
- [ ] T008 [P] Implement InstrumentKind enum in src/bun.js/telemetry.zig (custom=0, http=1, fetch=2, sql=3, redis=4, s3=5)
- [ ] T009 [P] Implement InstrumentRecord struct in src/bun.js/telemetry.zig (id, kind, protected JSValues, cached function pointers)
- [ ] T010 Implement Telemetry singleton in src/bun.js/telemetry.zig (instrument_table array indexed by InstrumentKind, atomic ID generation)
- [ ] T011 Implement Bun.telemetry.attach(instrument) in src/bun.js/telemetry.zig (validate functions, protect JSValues, return ID)
- [ ] T012 [P] Implement Bun.telemetry.detach(id) in src/bun.js/telemetry.zig (unprotect JSValues, remove from registry)
- [ ] T013 [P] Implement Bun.telemetry.isEnabledFor(kind) in src/bun.js/telemetry.zig (O(1) array length check)

### AttributeMap MVP Implementation (Zig)

- [ ] T014 Create AttributeKey enum in src/bun.js/telemetry.zig for semantic convention attributes (http_request_method, http_response_status_code, url_path, url_query, server_address, server_port)
- [ ] T015 [P] Implement AttributeMap struct in src/bun.js/telemetry.zig wrapping JSValue with fastSet/fastGet methods
- [ ] T016 [P] Implement attributeKeyToString() helper in src/bun.js/telemetry.zig for enum-to-string conversion
- [ ] T017 Implement AttributeMap.toJS() in src/bun.js/telemetry.zig returning plain JSValue object

### Native Hook Tests (NO @opentelemetry/* imports)

- [ ] T018 [P] Create test/js/bun/telemetry/attach-detach.test.ts validating attach() returns ID and detach() removes instrument
- [ ] T019 [P] Create test/js/bun/telemetry/validation.test.ts testing error handling for invalid instrument objects
- [ ] T020 [P] Create test/js/bun/telemetry/is-enabled.test.ts verifying isEnabledFor() returns correct state

**Checkpoint**: Foundation ready - native API tested, user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Distributed Tracing for HTTP Services (Priority: P1) 🎯 MVP

**Goal**: Developers building HTTP services with Bun can automatically capture distributed traces across their service architecture without monkey-patching or loader hooks.

**Independent Test**: Start a Bun HTTP server with OpenTelemetry SDK configured, make requests, verify traces appear in backend (Jaeger/Zipkin/console exporter).

**Success Criteria**:
- SC-001: Developers can set up tracing in <10 lines of code
- SC-002: HTTP server traces exported to standard backends with 100% of critical attributes
- SC-003: <5% latency overhead when enabled
- SC-004: <0.1% overhead when disabled
- SC-005: <20 lines of code changes for Node.js migration
- SC-009: Issue #3775 reproduction works
- SC-010: Examples from opentelemetry.io work out-of-the-box

### HTTP Server Native Hooks (Zig)

- [ ] T021 Create src/bun.js/telemetry_http.zig for HTTP-specific instrumentation logic
- [ ] T022 [P] Implement buildHttpStartAttributes() in src/bun.js/telemetry_http.zig (method, url, headers per captureAttributes config)
- [ ] T023 [P] Implement buildHttpEndAttributes() in src/bun.js/telemetry_http.zig (status_code, content_length, response headers)
- [ ] T024 [P] Implement buildHttpErrorAttributes() in src/bun.js/telemetry_http.zig (error_type, error_message, stack_trace)
- [ ] T025 [P] Implement header filtering in src/bun.js/telemetry_http.zig (deny-by-default security model with blocklist enforcement)
- [ ] T026 Add telemetry fields to src/bun.js/api/server/RequestContext.zig (telemetry_request_id: u64, request_start_time_ns: u64)
- [ ] T027 Integrate Telemetry hooks into src/bun.js/api/server.zig AFTER ensureURL(), BEFORE onRequest handler (invokeStart with HTTP attributes, set ctx.telemetry_request_id)
- [ ] T028 [P] Integrate Telemetry hook into src/bun.js/api/server/RequestContext.zig finalize() method (invokeEnd + exitContext for AsyncLocalStorage cleanup, set telemetry_request_id = 0)
- [ ] T029 [P] Integrate Telemetry hook into src/bun.js/api/server/RequestContext.zig handleReject() method (invokeError before error handling)
- [ ] T030 Implement ResponseBuilder pattern in src/bun.js/api/server/RequestContext.zig response paths (setStatus, setHeaders, injectHeaders, fireAndForget with defer cleanup)
- [ ] T031 [P] Integrate Telemetry hooks into src/js/node/_http_server.ts for Node.js compatibility layer (handleIncomingRequest before user handler, handleWriteHead before headers sent)

### Fetch Client Native Hooks (Zig)

- [ ] T032 Implement buildFetchStartAttributes() in src/bun.js/telemetry_http.zig (method, url, outgoing headers)
- [ ] T033 [P] Implement buildFetchEndAttributes() in src/bun.js/telemetry_http.zig (status_code, response headers, content_length)
- [ ] T034 [P] Implement buildFetchErrorAttributes() in src/bun.js/telemetry_http.zig (NetworkError, TimeoutError, DNSError, TLSError)
- [ ] T035 Integrate Telemetry hooks into src/bun.js/http/fetch.zig before fetch (invokeInject for trace propagation, invokeStart)
- [ ] T036 [P] Integrate Telemetry hooks into src/bun.js/http/fetch.zig after fetch completes (invokeEnd with response attributes)
- [ ] T037 [P] Integrate Telemetry hooks into src/bun.js/http/fetch.zig on fetch error (invokeError with error attributes)

### Native Hook Tests for HTTP/Fetch

⚠️ **CRITICAL**: All tests MUST use `waitForCondition()` helper instead of fixed `Bun.sleep()` delays, and `using` keyword for server cleanup (see Testing Pitfalls in plan.md)

- [ ] T038 [P] [US1] Create test/js/bun/telemetry/http-hooks.test.ts verifying Bun.serve() calls onOperationStart/End with correct attributes (use waitForCondition, using server)
- [ ] T039 [P] [US1] Create test/js/bun/telemetry/fetch-hooks.test.ts verifying fetch() calls onOperationStart/End/Inject with correct attributes
- [ ] T040 [P] [US1] Create test/js/bun/telemetry/operation-lifecycle.test.ts testing onOperationStart → onOperationEnd flow and error flow
- [ ] T041 [P] [US1] Create test/js/bun/telemetry/context-propagation.test.ts verifying request IDs are unique and attributes include operation.id
- [ ] T042 [P] [US1] Create test/js/bun/telemetry/header-security.test.ts validating blocked headers (authorization, cookie, api-key) never captured

### TypeScript Instrumentation Package (packages/bun-otel)

- [ ] T041 [P] [US1] Implement BunHttpInstrumentation class in packages/bun-otel/src/instruments/BunHttpInstrumentation.ts (attach native instrument, create server spans, handle W3C TraceContext)
- [ ] T042 [P] [US1] Implement BunFetchInstrumentation class in packages/bun-otel/src/instruments/BunFetchInstrumentation.ts (attach native instrument, create client spans, inject trace headers)
- [ ] T043 [US1] Implement BunSDK class in packages/bun-otel/src/BunSDK.ts extending NodeSDK with auto-enabled Bun instrumentations (see contracts/BunSDK.md for API specification)
- [ ] T044 [P] [US1] Implement AsyncContextManager workaround in packages/bun-otel/src/context/AsyncContextManager.ts for Bun-specific AsyncLocalStorage limitations
- [ ] T045 [P] [US1] Create packages/bun-otel/src/index.ts re-exporting BunSDK, instrumentations, and types
- [ ] T046 [P] [US1] Add semantic convention attribute mappings in BunHttpInstrumentation (http.request.method, url.path, http.response.status_code per OpenTelemetry v1.23.0)

### Package Tests (CAN import @opentelemetry/*)

- [ ] T047 [P] [US1] Create packages/bun-otel/test/BunSDK.test.ts testing SDK lifecycle (start, shutdown, auto-instrumentation registration)
- [ ] T048 [P] [US1] Create packages/bun-otel/test/BunHttpInstrumentation.test.ts verifying server spans created with correct attributes, W3C TraceContext extraction
- [ ] T049 [P] [US1] Create packages/bun-otel/test/BunFetchInstrumentation.test.ts verifying client spans created, trace headers injected
- [ ] T050 [P] [US1] Create packages/bun-otel/test/distributed-tracing.test.ts testing multi-hop trace propagation (Service A → Service B)
- [ ] T051 [P] [US1] Create packages/bun-otel/test/header-capture.test.ts testing captureAttributes configuration and default safe headers
- [ ] T052 [P] [US1] Create packages/bun-otel/test/issue-3775.test.ts reproducing GitHub #3775 scenario (verify /v1/traces endpoint receives data)

### Integration Tests (standalone projects)

- [ ] T053 [P] [US1] Create test/integration/opentelemetry/jaeger/ directory with package.json, docker-compose.yml (Jaeger container), and jaeger.test.ts
- [ ] T054 [P] [US1] Create test/integration/opentelemetry/zipkin/ directory with package.json, docker-compose.yml (Zipkin container), and zipkin.test.ts
- [ ] T055 [P] [US1] Create test/integration/opentelemetry/otlp/ directory with package.json, docker-compose.yml (OTLP collector), and otlp.test.ts

### Examples and Documentation

- [ ] T056 [P] [US1] Create packages/bun-otel/examples/basic-tracing.ts demonstrating 10-second setup with BunSDK
- [ ] T057 [P] [US1] Create packages/bun-otel/examples/distributed-tracing.ts showing multi-service trace propagation
- [ ] T058 [P] [US1] Create packages/bun-otel/examples/with-jaeger.ts complete Jaeger integration example
- [ ] T059 [P] [US1] Create packages/bun-otel/README.md with quickstart guide, API reference, and migration instructions from @opentelemetry/sdk-node

**Checkpoint**: At this point, User Story 1 (P1 - Distributed Tracing) should be fully functional and testable independently. MVP complete!

---

## Phase 4: User Story 2 - Metrics Collection for Runtime and Application Performance (Priority: P2)

**Goal**: Developers can collect standard OpenTelemetry metrics about their Bun application's performance including HTTP request rates, durations, runtime health metrics, and custom business metrics.

**Independent Test**: Configure metrics collection, run load tests, verify metric data exports to metrics backend or console.

**Success Criteria**:
- SC-007: System maintains stability under 10,000+ RPS with tracing enabled
- SC-008: Custom metrics can be created alongside automatic instrumentation

### Native Metrics Hooks (Zig)

- [ ] T060 [US2] Implement onOperationProgress hook invocation in src/bun.js/telemetry.zig (called on configurable poll interval after event loop flush)
- [ ] T061 [P] [US2] Implement buildRuntimeMetricsAttributes() in src/bun.js/telemetry.zig (process.runtime.bun.memory.heap_used, process.runtime.bun.memory.rss, process.runtime.bun.event_loop.lag, process.runtime.bun.gc.*)
- [ ] T062 [P] [US2] Implement runtime namespace detection in src/bun.js/telemetry.zig (process.runtime.bun.* if process.release.name === 'bun', otherwise process.runtime.nodejs.*)
- [ ] T063 Integrate periodic metrics sampling into src/bun.js/event_loop.zig (call onOperationProgress on configured interval)

### Native Metrics Tests

- [ ] T064 [P] [US2] Create test/js/bun/telemetry/metrics-hooks.test.ts verifying onOperationProgress called with runtime metrics attributes
- [ ] T065 [P] [US2] Create test/js/bun/telemetry/metrics-sampling.test.ts testing configurable poll interval behavior

### TypeScript Metrics Instrumentation

- [ ] T066 [P] [US2] Implement BunMetricsInstrumentation class in packages/bun-otel/src/instruments/BunMetricsInstrumentation.ts (attach native instrument, feed samples to @opentelemetry/sdk-metrics MeterProvider)
- [ ] T067 [US2] Extend BunHttpInstrumentation in packages/bun-otel/src/instruments/BunHttpInstrumentation.ts to emit HTTP metrics (http.server.request.count, http.server.request.duration histogram, http.server.active_requests gauge)
- [ ] T068 [P] [US2] Extend BunFetchInstrumentation in packages/bun-otel/src/instruments/BunFetchInstrumentation.ts to emit HTTP client metrics (http.client.request.count, http.client.request.duration)
- [ ] T069 Update BunSDK in packages/bun-otel/src/BunSDK.ts to auto-register metrics instrumentation when metricReaders configured (following NodeSDK pattern)

### Package Metrics Tests

- [ ] T070 [P] [US2] Create packages/bun-otel/test/metrics.test.ts verifying HTTP metrics collected (request count, duration histogram, active requests)
- [ ] T071 [P] [US2] Create packages/bun-otel/test/runtime-metrics.test.ts testing runtime metrics (memory, event loop lag, GC stats) exported correctly
- [ ] T072 [P] [US2] Create packages/bun-otel/test/custom-metrics.test.ts demonstrating custom metrics creation alongside automatic instrumentation

### Examples

- [ ] T073 [P] [US2] Create packages/bun-otel/examples/with-metrics.ts showing metrics configuration with Prometheus and OTLP exporters
- [ ] T074 [P] [US2] Update packages/bun-otel/README.md with metrics section (configuration, available metrics, custom metrics API)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently. Distributed tracing + metrics collection complete.

---

## Phase 5: User Story 3 - Structured Logging Integration (Priority: P3)

**Goal**: Developers can correlate application logs with traces by injecting trace context into log records using provided helpers or low-level APIs.

**Independent Test**: Make requests with tracing enabled, verify log entries include trace ID and span ID fields.

**Success Criteria**:
- Logs automatically include trace context when using high-level formatters
- Low-level API available for custom logging solutions

### Low-Level Trace Context API (Zig)

- [ ] T075 [P] [US3] Implement Bun.telemetry.getActiveSpan() in src/bun.js/telemetry.zig (returns {traceId, spanId} from AsyncLocalStorage context or null)
- [ ] T076 [P] [US3] Create test/js/bun/telemetry/get-active-span.test.ts verifying getActiveSpan() returns correct context within request handler

### High-Level Logger Integrations (TypeScript)

- [ ] T077 [P] [US3] Implement PinoFormatter class in packages/bun-otel/src/instruments/logging/PinoFormatter.ts (mixin() method injecting trace context)
- [ ] T078 [P] [US3] Implement WinstonFormatter class in packages/bun-otel/src/instruments/logging/WinstonFormatter.ts (format() method injecting trace context)
- [ ] T079 Update BunSDK in packages/bun-otel/src/BunSDK.ts to export logging helpers
- [ ] T080 [P] [US3] Update packages/bun-otel/src/index.ts to re-export logging formatters

### Package Logging Tests

- [ ] T081 [P] [US3] Create packages/bun-otel/test/logging.test.ts verifying PinoFormatter and WinstonFormatter inject trace context correctly
- [ ] T082 [P] [US3] Create packages/bun-otel/test/manual-logging.test.ts testing low-level getActiveSpan() API for custom logger integration

### Examples

- [ ] T083 [P] [US3] Create packages/bun-otel/examples/with-logging-pino.ts demonstrating Pino integration with automatic trace context
- [ ] T084 [P] [US3] Create packages/bun-otel/examples/with-logging-winston.ts demonstrating Winston integration
- [ ] T085 [P] [US3] Create packages/bun-otel/examples/manual-logging.ts showing custom logger using getActiveSpan()
- [ ] T086 Update packages/bun-otel/README.md with logging section (high-level formatters, low-level API, examples)

**Checkpoint**: All user stories (P1, P2, P3) should now be independently functional. Complete OpenTelemetry support implemented!

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories, performance validation, and documentation

### Performance Validation

- [ ] T087 [P] Create benchmark suite in packages/bun-otel/benchmarks/ using autocannon (baseline, disabled, enabled, with exporter)
- [ ] T088 Run benchmarks and validate SC-003 (<5% overhead enabled) and SC-004 (<0.1% overhead disabled)
- [ ] T089 [P] Profile memory usage under sustained load, validate bounded growth (maps cleaned up, no leaks)

### Documentation and Polish

- [ ] T090 [P] Create packages/bun-otel/CHANGELOG.md documenting all features and changes from configure() API
- [ ] T091 [P] Create packages/bun-otel/MIGRATION.md with migration guide from @opentelemetry/sdk-node and from old configure() API
- [ ] T092 [P] Add JSDoc comments to all public APIs in packages/bun-otel/src/
- [ ] T093 Update Bun main documentation with OpenTelemetry quickstart guide
- [ ] T094 [P] Add TypeScript type definitions (.d.ts) for Bun.telemetry global namespace

### Code Quality

- [ ] T095 [P] Run eslint and prettier on packages/bun-otel/ codebase
- [ ] T096 [P] Add error handling wrappers around all native hook invocations (defensive isolation)
- [ ] T097 Review all protected JSValues for matching protect/unprotect pairs (memory safety audit)
- [ ] T098 [P] Add input validation to all public APIs (throw TypeError for invalid arguments)

### Final Validation

- [ ] T099 Run all tests (native, package, integration) and verify 100% pass rate
- [ ] T100 Validate quickstart.md examples work end-to-end with real backends
- [ ] T101 [P] Run `bun run zig:check-all` to verify cross-platform compilation
- [ ] T102 Create comprehensive end-to-end test combining tracing + metrics + logging in single application

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2) - MVP target
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2) - Can start in parallel with US1 if staffed
- **User Story 3 (Phase 5)**: Depends on Foundational (Phase 2) - Can start in parallel with US1/US2 if staffed
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Integrates with US1 HTTP instrumentation but independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Uses trace context from US1 but independently testable

### Within Each User Story

- Native Zig hooks before TypeScript instrumentation
- Native tests (test/js/bun/telemetry/) before package tests
- Core implementation before integration tests
- Examples and documentation after implementation complete

### Parallel Opportunities

- **Phase 1**: Tasks T002, T003, T004, T005, T006 can run in parallel
- **Phase 2**:
  - T008, T009, T012, T013 can run in parallel after T007
  - T014, T015, T016 can run in parallel after T010
  - T018, T019, T020 can run in parallel after T017
- **Phase 3 (US1)**:
  - T022, T023, T024, T025 can run in parallel after T021
  - T028, T029 can run in parallel after T027
  - T031, T032 can run in parallel after T030
  - T034, T035 can run in parallel after T033
  - T036, T037, T038, T039, T040 can run in parallel after native hooks complete
  - T041, T042, T044, T045, T046 can run in parallel
  - T047, T048, T049, T050, T051, T052 can run in parallel after T043
  - T053, T054, T055 can run in parallel
  - T056, T057, T058, T059 can run in parallel
- **Phase 4 (US2)**:
  - T061, T062 can run in parallel after T060
  - T064, T065 can run in parallel after T063
  - T066, T068 can run in parallel
  - T070, T071, T072 can run in parallel after T069
  - T073, T074 can run in parallel
- **Phase 5 (US3)**:
  - T075, T076 can run in parallel
  - T077, T078, T080 can run in parallel
  - T081, T082 can run in parallel after T079
  - T083, T084, T085, T086 can run in parallel
- **Phase 6**:
  - T087, T089, T090, T091, T092, T094, T095, T098, T101 can run in parallel

---

## Parallel Example: User Story 1 (Distributed Tracing)

```bash
# After Phase 2 Foundational complete, launch HTTP server native hooks together:
Task: "Implement buildHttpStartAttributes() in src/bun.js/telemetry_http.zig"
Task: "Implement buildHttpEndAttributes() in src/bun.js/telemetry_http.zig"
Task: "Implement buildHttpErrorAttributes() in src/bun.js/telemetry_http.zig"
Task: "Implement header filtering in src/bun.js/telemetry_http.zig"

# Launch TypeScript instrumentations together:
Task: "Implement BunHttpInstrumentation class in packages/bun-otel/src/instruments/BunHttpInstrumentation.ts"
Task: "Implement BunFetchInstrumentation class in packages/bun-otel/src/instruments/BunFetchInstrumentation.ts"
Task: "Implement AsyncContextManager in packages/bun-otel/src/context/AsyncContextManager.ts"

# Launch all native tests together:
Task: "Create test/js/bun/telemetry/http-hooks.test.ts"
Task: "Create test/js/bun/telemetry/fetch-hooks.test.ts"
Task: "Create test/js/bun/telemetry/operation-lifecycle.test.ts"
Task: "Create test/js/bun/telemetry/context-propagation.test.ts"
Task: "Create test/js/bun/telemetry/header-security.test.ts"

# Launch all package tests together after BunSDK complete:
Task: "Create packages/bun-otel/test/BunSDK.test.ts"
Task: "Create packages/bun-otel/test/BunHttpInstrumentation.test.ts"
Task: "Create packages/bun-otel/test/BunFetchInstrumentation.test.ts"
Task: "Create packages/bun-otel/test/distributed-tracing.test.ts"
Task: "Create packages/bun-otel/test/header-capture.test.ts"
Task: "Create packages/bun-otel/test/issue-3775.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (1-2 days)
2. Complete Phase 2: Foundational (7-10 days - refactor to attach/detach per TELEMETRY_REFACTOR.md)
3. Complete Phase 3: User Story 1 (5-7 days)
4. **STOP and VALIDATE**: Test distributed tracing independently with Jaeger/Zipkin
5. Deploy/demo if ready - addresses GitHub issue #3775

**MVP Deliverables**:
- Native attach/detach API
- HTTP server and fetch client automatic instrumentation
- W3C TraceContext propagation
- Standard OpenTelemetry exporters (OTLP, Jaeger, Zipkin)
- <20 lines of code migration from Node.js
- <5% performance overhead

### Incremental Delivery

1. Complete Setup + Foundational (8-12 days) → Foundation ready
2. Add User Story 1 (5-7 days) → Test independently → Deploy/Demo (MVP! ✅)
3. Add User Story 2 (2-3 days) → Test independently → Deploy/Demo (+ Metrics)
4. Add User Story 3 (1-2 days) → Test independently → Deploy/Demo (+ Logging)
5. Polish (2-3 days) → Production-ready release

**Total Estimated Time**: 18-27 days for MVP, 23-32 days for full P1+P2+P3 implementation

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together (8-12 days)
2. Once Foundational is done:
   - **Developer A**: User Story 1 native Zig hooks (HTTP + Fetch)
   - **Developer B**: User Story 1 TypeScript instrumentations
   - **Developer C**: User Story 1 tests (native + package + integration)
3. After US1 complete:
   - **Developer A**: User Story 2 (metrics)
   - **Developer B**: User Story 3 (logging)
   - **Developer C**: Polish and documentation
4. Stories integrate and release together

---

## Notes

- **[P] tasks** = different files, no blocking dependencies, can run in parallel
- **[Story] label** maps task to specific user story for traceability
- **Test-First Development**: All tests must FAIL before implementation (use `USE_SYSTEM_BUN=1 bun test <file>` to verify)
- **Build Validation**: Always use `bun bd test <file>` to test changes, never `bun test` directly
- **Memory Safety**: Use `defer` in Zig for cleanup, ensure all protected JSValues have matching unprotect
- **Cross-Platform**: Run `bun run zig:check-all` after platform-specific Zig changes
- **Security**: Header capture deny-by-default enforced at Zig layer (authorization, cookie, api-key always blocked)
- **Performance Goals**: <0.1% overhead disabled, <5% overhead enabled, validated with benchmarks
- **Migration**: BunSDK wraps NodeSDK for <20 lines migration from @opentelemetry/sdk-node

---

## Task Count Summary

- **Phase 1 (Setup)**: 6 tasks
- **Phase 2 (Foundational)**: 14 tasks (CRITICAL - blocks all user stories)
- **Phase 3 (User Story 1 - P1)**: 39 tasks (MVP target)
- **Phase 4 (User Story 2 - P2)**: 15 tasks
- **Phase 5 (User Story 3 - P3)**: 12 tasks
- **Phase 6 (Polish)**: 16 tasks

**Total**: 102 tasks

**Parallel Opportunities**: ~60% of tasks can run in parallel within phases (marked with [P])

**MVP Scope (Recommended)**: Phase 1 + Phase 2 + Phase 3 = 59 tasks (distributed tracing only)

**Full Feature (P1+P2+P3)**: All phases = 102 tasks
