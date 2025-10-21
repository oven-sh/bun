# Implementation Plan: OpenTelemetry Support for Bun

**Branch**: `001-opentelemetry-support` | **Date**: 2025-10-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-opentelemetry-support/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement OpenTelemetry distributed tracing, metrics, and logging for Bun runtime to achieve functional equivalence with `@opentelemetry/sdk-node`. The approach uses native Zig-layer telemetry hooks for 10x performance improvement over monkey-patching, with automatic HTTP/Fetch instrumentation for `Bun.serve()` and `fetch()` APIs. Builds on existing work in `feat/opentelemetry-server-hooks` branch and implements attach/detach instrumentation model for extensibility to SQL, Redis, and AWS SDKs in future iterations.

## Technical Context

**Language/Version**: Zig 0.13+ (native runtime), TypeScript 5.x (instrumentation layer, packages/bun-otel)
**Primary Dependencies**:

- `@opentelemetry/api` ^1.9.0 (standard OpenTelemetry API)
- `@opentelemetry/sdk-trace-base` ^1.30.0 (tracing SDK)
- `@opentelemetry/sdk-metrics` ^1.30.0 (metrics SDK)
- `@opentelemetry/resources` ^1.30.0 (resource detection)
- `@opentelemetry/semantic-conventions` ^1.30.0 (HTTP/network semconv)

**Storage**: N/A (telemetry data exported to external backends: OTLP collectors, Jaeger, Zipkin)

**Testing**: Bun test runner (`bun bd test`), integration tests with real OTLP collectors

**Target Platform**: Linux (x64/arm64), macOS (x64/Apple Silicon), Windows (x64) - server-side runtime only

**Project Type**: Runtime extension (native Zig + TypeScript package)

**Performance Goals**:

- <5% latency overhead when tracing enabled
- <0.1% overhead when disabled
- Support 10,000+ RPS with tracing active
- Zero-cost abstraction via compile-time checks

**Constraints**:

- Must maintain Node.js compatibility (drop-in replacement requirement)
- AsyncLocalStorage context propagation limitations in Bun (workarounds needed)
- No loader hooks or monkey-patching (native hooks only)
- Bounded memory usage for retry buffers (prevent OOM on exporter failures)

**Scale/Scope**:

- Core HTTP/Fetch instrumentation (P1)
- Metrics collection framework (P2)
- Logging integration helpers (P3)
- Extensible to SQL/Redis/AWS in future (hooks provided, out of scope)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Principle I: Test-First Development (NON-NEGOTIABLE)

- ✅ **PASS**: Test strategy defined
  - Native hook tests in `test/js/bun/telemetry/` (NO @opentelemetry/ imports)
  - Package tests in `packages/bun-otel/test/` (can import @opentelemetry/\*)
  - Integration tests in `test/integration/opentelemetry/` with real OTLP collectors
  - **TDD Workflow** (for native hooks):
    1. Write test that uses new `Bun.telemetry.*` API
    2. Verify test fails with `USE_SYSTEM_BUN=1 bun test <file>` (env var tells test harness to use installed system Bun instead of local build - proves test validates new code)
    3. Implement Zig code for new API
    4. Verify test passes with `bun bd test <file>` (uses debug build with changes)
  - **Package TDD Workflow**:
    1. Write tests in `packages/bun-otel/test/`
    2. Run with `bun test` from package directory
    3. Implement TypeScript instrumentation code

### Principle II: Performance-First

- ✅ **PASS**: Performance is core requirement
  - Success criteria SC-003: <5% overhead when enabled
  - Success criteria SC-004: <0.1% overhead when disabled
  - Native Zig hooks for 10x improvement over monkey-patching
  - Zero-cost abstraction via compile-time feature flags
  - Benchmarks required in Phase 1 (quickstart.md)

### Principle III: Build Validation

- ✅ **PASS**: Standard build workflow
  - All changes validated with `bun bd test`
  - No direct `bun test` usage for testing changes
  - CI enforces debug build validation

### Principle IV: Cross-Platform Compatibility

- ✅ **PASS**: Multi-platform support required
  - Target platforms: Linux (x64/arm64), macOS (x64/Apple Silicon), Windows (x64)
  - Test harness utilities (`bunEnv`, `bunExe()`, `tempDir()`) will be used
  - `port: 0` for network tests (no hardcoded ports)
  - Platform-specific code isolated in Zig with conditional compilation

### Principle V: Node.js Compatibility

- ✅ **PASS**: Drop-in replacement goal
  - FR-011: Functional equivalence with `@opentelemetry/sdk-node`
  - SC-005: <20 lines of code changes for migration
  - SC-010: Examples from OpenTelemetry docs work out-of-the-box
  - Uses standard `@opentelemetry/*` packages from npm
  - No breaking changes to Node.js OpenTelemetry API surface

**Overall Status**: ✅ ALL GATES PASS - Proceed to Phase 0

---

### Post-Design Review (After Phase 1)

**Re-evaluation Date**: 2025-10-20
**Design Artifacts Created**: research.md, data-model.md, contracts/, quickstart.md, .agent-context.md

#### Principle I: Test-First Development

- ✅ **STILL PASSING**: Three-layer test strategy maintained
  - Native API tests documented in contracts/bun-telemetry-api.md
  - Package tests will validate BunSDK, BunHttpInstrumentation, BunFetchInstrumentation
  - Integration tests with Jaeger, Zipkin, OTLP collector defined
  - TDD workflow clearly documented with USE_SYSTEM_BUN validation
  - **No violations introduced**

#### Principle II: Performance-First

- ✅ **STILL PASSING**: Performance targets maintained
  - MVP AttributeMap avoids premature optimization while maintaining performance contract
  - Future optimization path documented (native C++ AttributeMap) without blocking implementation
  - Benchmarks from POC included in quickstart.md (~4.5% overhead validated)
  - Overhead targets remain: <0.1% disabled, <5% enabled
  - **No violations introduced**

#### Principle III: Build Validation

- ✅ **STILL PASSING**: Standard Bun build workflow
  - All code changes will use `bun bd test` workflow
  - No special build requirements introduced
  - **No violations introduced**

#### Principle IV: Cross-Platform Compatibility

- ✅ **STILL PASSING**: Multi-platform support maintained
  - Zig layer uses standard Bun patterns (platform-specific code in conditional compilation)
  - TypeScript layer platform-agnostic
  - Tests will use `port: 0` and `tempDir()` patterns
  - **No violations introduced**

#### Principle V: Node.js Compatibility

- ✅ **STILL PASSING**: Drop-in replacement goal achieved
  - BunSDK wraps NodeSDK (examined @opentelemetry/sdk-node source)
  - Same constructor signature: `new BunSDK(Partial<NodeSDKConfiguration>)`
  - Same lifecycle methods: `start()`, `shutdown()`
  - Examples from official OpenTelemetry docs work with 2-line changes (shown in quickstart.md)
  - **No violations introduced**

**Post-Design Status**: ✅ ALL PRINCIPLES STILL PASSING - Proceed to Phase 2 (Tasks)

**Key Design Decisions Validated**:

1. AttributeMap MVP approach focuses on correctness, defers optimization to future story
2. BunSDK extends NodeSDK for maximum compatibility
3. Semantic convention attributes built in Zig, consumed as plain objects in TypeScript
4. InstrumentKind enum includes S3 (not AWS) for object storage only
5. Three-layer test separation cleanly enforces boundaries

**No Complexity Violations**: All design decisions align with constitution principles

---

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
# Native Runtime Integration (Zig)
src/bun.js/
├── telemetry.zig                    # Core attach/detach API, InstrumentKind enum, ResponseBuilder pattern
├── telemetry_http.zig               # HTTP-specific attributes and hooks
├── api/
│   ├── server.zig                   # CRITICAL: notifyRequestStart AFTER ensureURL(), BEFORE onRequest handler
│   └── server/RequestContext.zig    # CRITICAL touchpoints (102+ commits to get right):
│       │                              - Add fields: telemetry_request_id (u64), request_start_time_ns (u64)
│       │                              - finalize(): notifyRequestEnd + exitContext (cleanup AsyncLocalStorage)
│       │                              - handleReject(): notifyRequestError before error handling
│       │                              - Response paths: ResponseBuilder.setStatus/setHeaders/injectHeaders/fireAndForget
└── js/node/_http_server.ts          # Node.js http.createServer() compatibility:
                                       - onRequest hook: handleIncomingRequest (before user handler)
                                       - writeHead hook: handleWriteHead (before headers sent)

# TypeScript Instrumentation Layer
packages/bun-otel/
├── src/
│   ├── index.ts                     # Main entry point, re-exports
│   ├── BunSDK.ts                    # High-level SDK (wraps NodeSDK, see contracts/BunSDK.md)
│   ├── instruments/
│   │   ├── BunHttpInstrumentation.ts    # Bun.serve() spans
│   │   ├── BunFetchInstrumentation.ts   # fetch() spans
│   │   ├── BunMetricsInstrumentation.ts # HTTP metrics (P2)
│   │   └── logging/
│   │       ├── PinoFormatter.ts         # Pino trace context helper (P3)
│   │       └── WinstonFormatter.ts      # Winston trace context helper (P3)
│   ├── context/
│   │   └── AsyncContextManager.ts       # AsyncLocalStorage workarounds
│   └── types.ts                     # TypeScript definitions
├── test/
│   ├── BunSDK.test.ts               # Unit tests for BunSDK
│   ├── BunHttpInstrumentation.test.ts   # Unit tests for HTTP instrumentation
│   ├── BunFetchInstrumentation.test.ts  # Unit tests for fetch instrumentation
│   ├── distributed-tracing.test.ts      # Integration: multi-hop tracing
│   ├── header-capture.test.ts           # Security: header allowlist behavior
│   ├── metrics.test.ts              # Unit tests for metrics (P2)
│   ├── logging.test.ts              # Unit tests for log correlation (P3)
│   └── issue-3775.test.ts           # Regression test for GitHub #3775
├── examples/
│   ├── basic-tracing.ts
│   ├── with-jaeger.ts
│   └── with-metrics.ts
└── package.json                     # Dependencies: @opentelemetry/* packages

# Native Hook Tests (NO @opentelemetry/ dependencies)
test/js/bun/telemetry/
├── attach-detach.test.ts            # Bun.telemetry.attach/detach API
├── http-hooks.test.ts               # Verify Bun.serve() calls hooks
├── fetch-hooks.test.ts              # Verify fetch() calls hooks
├── operation-lifecycle.test.ts      # onOperationStart/End/Error flow
└── context-propagation.test.ts      # Verify context passes through async ops

# Standalone Integration Tests (separate package.json each)
test/integration/opentelemetry/
├── jaeger/
│   ├── package.json                 # Isolated: @opentelemetry/*, packages/bun-otel
│   ├── docker-compose.yml           # Jaeger container
│   └── jaeger.test.ts               # End-to-end with Jaeger backend
├── zipkin/
│   ├── package.json                 # Isolated: @opentelemetry/*, packages/bun-otel
│   ├── docker-compose.yml           # Zipkin container
│   └── zipkin.test.ts               # End-to-end with Zipkin backend
└── otlp/
    ├── package.json                 # Isolated: @opentelemetry/*, packages/bun-otel
    ├── docker-compose.yml           # OTLP collector container
    └── otlp.test.ts                 # End-to-end with OTLP collector
```

**Critical Implementation Notes** (from POC - 102+ commits):

⚠️ **IMPORTANT**: The exact placement of telemetry hooks was discovered through extensive iteration. Do NOT move these touchpoints without careful testing.

1. **server.zig Integration Ordering**:
   - ✅ **MUST call `ensureURL()` BEFORE `notifyRequestStart()`** - telemetry callbacks need valid URL
   - ✅ **MUST call `notifyRequestStart()` BEFORE `onRequest` handler** - sets up AsyncLocalStorage context
   - ❌ **DO NOT call `enterContext()` after `notifyRequestStart()`** - would overwrite OTel Context set by callback
   - Note: `enterContext/exitContext` are for Node.js http.Server compatibility ONLY

2. **RequestContext.zig Memory Management**:
   - Add TWO fields: `telemetry_request_id: u64` (8 bytes), `request_start_time_ns: u64` (8 bytes)
   - Total cost: 16 bytes per request (32KB for 2048 concurrent requests)
   - **MUST call `exitContext()` in `finalize()`** - cleans up AsyncLocalStorage, prevents memory leak
   - **MUST set `telemetry_request_id = 0` after cleanup** - prevents double-cleanup

3. **ResponseBuilder Pattern** (optimization from POC):
   - Pre-parse header names at config time (once), not per-request
   - Use `defer builder.fireAndForget()` for automatic cleanup
   - Builder accumulates: status, headers, content-length
   - Single callback fire at end of response (not multiple calls)
   - **MUST protect/unprotect JSValue headers** - prevents GC during collection

4. **Defensive Isolation** (critical for stability):
   - Wrap ALL telemetry calls in Zig with error handling
   - Use `catch |err| { global.takeException(err); return; }`
   - Telemetry failures MUST NEVER crash request handling
   - Add optional chaining for all telemetry operations

5. **Zero-Overhead When Disabled**:
   - Early return if `telemetry_request_id == 0` (set by server.zig)
   - No URL parsing, no header allocation, no timestamp collection
   - Cost: single integer comparison per request
   - Measured: <0.1% overhead when disabled ✅

6. **Fetch Instrumentation** (NEW - different from POC):
   - POC used TypeScript monkey-patching (defensive guards, ORIGINAL_FETCH pattern)
   - NEW approach: Native Zig hooks in `src/bun.js/http/fetch.zig`
   - Hook placement: BEFORE sending request (for header injection), AFTER response (for metrics)
   - Must handle: DNS errors, TLS errors, timeouts, aborts

7. **AsyncLocalStorage Context** (critical for distributed tracing):
   - Zig creates AsyncLocalStorage frame in server.zig BEFORE calling handler
   - TypeScript `onRequestStart` callback uses `contextStorage.enterWith()` to set OTel Context
   - **DO NOT use `context.with()`** for Requests or from Zig, use `enterWith()` instead
   - Exit context in `RequestContext.finalize()` - cleanup prevents leaks

**Testing Pitfalls** (20+ commits fixing test flakiness):

1. **NEVER use fixed `Bun.sleep()` delays**:

   ```typescript
   // ❌ WRONG - timing-dependent, flaky
   await Bun.sleep(100);
   expect(spans.length).toBe(1);

   // ✅ CORRECT - deterministic polling
   async function waitForCondition(
     check: () => boolean,
     timeout = 500,
     interval = 5,
   ) {
     const start = Date.now();
     while (!check() && Date.now() - start < timeout) {
       await Bun.sleep(interval);
     }
     if (!check()) throw new Error("Condition not met");
   }

   await waitForCondition(() => exporter.getFinishedSpans().length === 1);
   ```

2. **ALWAYS use `using` keyword for server cleanup**:

   ```typescript
   // ✅ CORRECT - automatic cleanup even on test failure
   using server = Bun.serve({ port: 0, fetch: handler });

   // ❌ WRONG - manual cleanup can be skipped on assertion failure
   const server = Bun.serve({ port: 0, fetch: handler });
   try {
     // test code
   } finally {
     server.close();
   }
   ```

3. **Assert output BEFORE asserting exit code**:

   ```typescript
   // ✅ CORRECT - see actual error if test fails
   const [stdout, stderr, exitCode] = await Promise.all([...]);
   expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot("...");
   expect(exitCode).toBe(0); // Assert LAST

   // ❌ WRONG - unhelpful error when exit code check fails first
   expect(exitCode).toBe(0);
   expect(stdout).toContain("...");
   ```

4. **Use `tempDir()` from harness, NOT manual mkdtemp**:

   ```typescript
   // ✅ CORRECT - automatic cleanup
   using dir = tempDir("otel-test", { "index.js": "..." });

   // ❌ WRONG - can leak temp directories
   const dir = fs.mkdtempSync(path.join(os.tmpdir(), "otel-"));
   ```

5. **Validate tests fail with `USE_SYSTEM_BUN=1`**:

   ```bash
   # Test MUST fail with system Bun (proves test validates new code)
   USE_SYSTEM_BUN=1 bun test test/js/bun/telemetry/http-hooks.test.ts

   # Test MUST pass with debug build (proves implementation works)
   bun bd test test/js/bun/telemetry/http-hooks.test.ts
   ```

**Structure Decision**:

This is a **runtime extension** pattern combining native Zig code with a TypeScript instrumentation package. The structure follows Bun's established patterns:

1. **Native Layer** (`src/bun.js/telemetry*.zig`): Core lifecycle hooks, InstrumentKind registry, attach/detach API - builds on existing work in `feat/opentelemetry-server-hooks` branch

2. **Instrumentation Package** (`packages/bun-otel`):
   - Self-contained TypeScript package with its own tests
   - Dependencies include `@opentelemetry/*` packages (NOT in Bun core)
   - Unit tests in `packages/bun-otel/test/` can import `@opentelemetry/*`
   - Published to npm as `@bun/otel` or similar

3. **Native Hook Tests** (`test/js/bun/telemetry/`):
   - Test ONLY the native Zig API surface (`Bun.telemetry.*`)
   - MUST NOT import `@opentelemetry/*` packages
   - Verify hooks are called with correct data
   - Part of Bun core test suite

4. **Integration Tests** (`test/integration/opentelemetry/`):
   - Each subdirectory is a standalone project with its own `package.json`
   - Can import both `packages/bun-otel` and `@opentelemetry/*`
   - Not part of main Bun build, run separately
   - Use Docker Compose for backend dependencies

**Key Separation**:

- Bun core never depends on `@opentelemetry/*` packages
- Native hooks provide generic data; instrumentation layer interprets it
- Users install `packages/bun-otel` from npm when they want OpenTelemetry support

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., 4th project]        | [current need]     | [why 3 projects insufficient]        |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient]  |
