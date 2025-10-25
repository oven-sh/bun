This PR adds a `Bun.telemetry` and a `bun-otel` package with a Bun-specific implementation of the [OpenTelemetry](https://opentelemetry.io) for `Bun.serve()` (and `Node.js http.createServer()`!), addressing issue #3775 where the native server did not work with `AsyncLocalStorage` for context propagation.

In addition, this provides a foundation for moving to full compatibility with auto instrumentation, as well as manual configuration via a `BunSDK` helper that tracks the `NodeSDK` utility's API. In the spirit of Bun's performance advantage, we've added native instrumentation hooks at each Bun-native replacement:

- Bun.serve
- fetch
- ...

# Out of scope:

## OpenTelemetry C++ SDK

This PR intentionally re-uses the existing `opentelemetry-js` (node) library for aggregating and sending telemetry for a few reasons:

- Bun aims to be Node-drop-in compatible, so it necessarily should support the same OTel library
- Using the C++ library and creating Meter and Client bindings would add 10-20mb to the bun executable (Claude's estimate, not tested)
- The scope is already huge

However, the API surfaces defined here would be perfectly amenable to providing native implementation of the collectors, with native HTTP calls etc, should someone else want to undertake this in the future!

# Architecture

This is a Significant API Evolution from the [POC](https://github.com/oven-sh/bun/pull/23798). The POC used a configure-based API with request callbacks, while the current spec uses an attach/detach pattern with operation-centric callbacks and explicit InstrumentKind types. It incorporates much of the @coderabbitai feedback from the POC (which addressed some 250 comments).

## What's actually in here

The native layer lives in `src/telemetry/main.zig` - implements the `Bun.telemetry` namespace with attach/detach APIs, operation lifecycle hooks (start/end/error/progress), and attribute map handling. The Zig code is designed for zero overhead when disabled (<0.1%) and minimal overhead when enabled (<5%). Type definitions for the public API are in `packages/bun-types/telemetry.d.ts` so anyone can write custom instrumentations without depending on our SDK.

Integration points are minimal: `src/js/node/_http_server.ts` and `_http_client.ts` got 2-4 hook insertions each to notify the native layer about request/response lifecycle events. These call straight through to Zig - no TypeScript bridge modules that would add startup cost. The hooks are no-ops when telemetry isn't attached.

The `packages/bun-otel` package provides the TypeScript instrumentation layer - imports `@opentelemetry/api` and semantic conventions, registers with `Bun.telemetry.attach()`, and maps native operation callbacks to OpenTelemetry spans. The package includes `BunSDK` (wraps NodeSDK), `BunHttpInstrumentation` (handles both Bun.serve and Node http), and will include fetch/sql/redis instrumentations. Only loads if you import it, so zero cost if you don't use telemetry.

This PR focuses on solving #3775 - getting HTTP tracing working with proper context propagation. But the `Bun.telemetry` API is extensible by design. Adding new instrumentation kinds (fetch, sql, redis, s3) just means adding a new enum variant and calling the same hooks from the relevant native code. The attach/detach pattern and attribute map handling are instrument-agnostic, so the foundation is there to expand coverage across the rest of Bun's native APIs.

## How did you verify your code works?

**Test suite**: 147 passing tests across 12 files with 383 expect() calls covering:
- `BunHttpInstrumentation.test.ts` - HTTP server span creation, semantic conventions, error tracking
- `distributed-tracing.test.ts` & `distributed-tracing-node-http.test.ts` - W3C TraceContext propagation across service boundaries
- `context-propagation.test.ts` - AsyncLocalStorage integration across async boundaries (setTimeout, generators, promises)
- `BunFetchInstrumentation.test.ts` - HTTP client instrumentation for outbound requests
- `node-http.test.ts` - Node.js http.createServer() compatibility
- `server-metrics.test.ts` - Runtime metrics collection (memory, event loop lag)
- `resources.test.ts` - Resource attribute detection (service.name, environment)
- `basic.test.ts` - Core Bun.telemetry attach/detach APIs
- Native layer tests in `test/js/bun/telemetry/` - Zig API validation, performance benchmarks (<0.1% overhead when disabled)

## What is still left to do

- Fix 2 failing tests in `test/js/bun/telemetry/http-hooks.test.ts` (query parameter attribute extraction)
- Complete end-to-end validation in `test/integration/telemetry/` - infrastructure exists (docker-compose with OTLP collector + Jaeger), server runs successfully and handles load (1922 req/sec, 100% success), but trace export pipeline needs debugging
- Performance benchmarking: Validate <5% overhead claim with sustained 10k+ RPS load using `oha` (basic load testing infrastructure proven working)
- Example applications: Add examples showing real-world usage patterns (multi-service tracing, custom instrumentation, metrics dashboards)
- Documentation: Complete `packages/bun-otel/README.md` with getting started guide and migration instructions from `@opentelemetry/sdk-node`
