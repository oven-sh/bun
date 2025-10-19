# Telemetry Test Strategy

## Overview

Telemetry tests are split into two categories with different purposes and locations.

## Core Tests (test/js/bun/)

**Location:** `test/js/bun/`

**Purpose:** Verify telemetry insertion points exist and are called

**What they test:**
- Insertion points in `src/js/node/_http_server.ts` invoke `_node_binding` hooks
- Insertion points in Bun.serve invoke high-level callbacks
- Callbacks receive basic arguments (id, request, statusCode, etc.)
- Everything works when tracing is disabled (default state)

**What they do NOT test:**
- OpenTelemetry span creation
- Trace context propagation
- Header extraction semantics
- Span attribute mapping
- OTel SDK integration

**Key principle:** Test that the hooks are called, not what they do with the data.

### Core Test Files

| File | Tests |
|------|-------|
| `telemetry-basic.test.ts` | API exists, enable/disable |
| `telemetry.test.ts` | API with servers, request tracking |
| `telemetry-status.test.ts` | Status code callback invocation |
| `telemetry-server.test.ts` | Server integration scenarios |
| `http/serve-telemetry.test.ts` | Bun.serve callback invocation |
| `http/node-telemetry.test.ts` | Node.js _node_binding hook invocation |
| `test-no-telemetry.test.ts` | Servers work without telemetry |

## bun-otel Tests (packages/bun-otel/)

**Location:** `packages/bun-otel/`

**Purpose:** Verify OpenTelemetry integration works correctly

**What they test:**
- `BunSDK` and `installBunNativeTracing()` configure telemetry correctly
- Spans are created with correct attributes
- W3C trace context propagation works
- Headers are extracted correctly (both Bun.serve and Node.js)
- Content-length is extracted and validated
- Error scenarios create error spans
- Span lifecycle (start, end, error) works correctly
- Resource detection and configuration

**Key principle:** Test the semantic behavior and OTel integration, not the insertion points.

### bun-otel Test Files

| File | Tests |
|------|-------|
| `basic.test.ts` | BunSDK creates spans for HTTP requests |
| `context-propagation.test.ts` | W3C trace context propagation |
| `node-http.test.ts` | Node.js http.createServer integration |
| `resources.test.ts` | Resource configuration and auto-detection |
| `distributed-tracing.test.ts` | AsyncLocalStorage context propagation across async boundaries (setTimeout, setImmediate, nested async functions, generators, parallel requests) |

## Architecture

### Bun.serve

- Uses **high-level callbacks**: `onRequestStart`, `onResponseHeaders`, `onRequestEnd`, `onRequestError`
- Configured via `Bun.telemetry.configure({ onRequestStart, ... })`
- These callbacks are invoked directly by Bun's HTTP server

### Node.js http.createServer

- Uses **_node_binding hooks**: `handleIncomingRequest`, `handleWriteHead`
- Configured via `Bun.telemetry.configure({ _node_binding: { ... } })`
- These hooks are internal, used by OTel integration
- High-level callbacks (onRequestStart, etc.) do NOT work for Node.js servers

### Why the separation?

This keeps the insertion surface area minimal in `src/js/node/_http_server.ts`:
- Only 2 insertion points: `handleIncomingRequest` and `handleWriteHead`
- All complexity handled in TypeScript (bun-otel package)
- Clean separation between core telemetry (insertion points) and OTel (semantic behavior)

## Example Test Comparison

### ✅ Core Test

```typescript
// test/js/bun/http/node-telemetry.test.ts
test("_node_binding.handleIncomingRequest is invoked with IncomingMessage and ServerResponse", async () => {
  const calls = [];
  const mockBinding = {
    handleIncomingRequest(req, res) {
      calls.push({ req, res });
      return 123;
    },
  };

  Bun.telemetry.configure({ _node_binding: mockBinding });

  // ... make request ...

  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0].req).toBeDefined();
  expect(calls[0].res).toBeDefined();
});
```

### ✅ bun-otel Test

```typescript
// packages/bun-otel/node-http.test.ts
test("extracts user-agent header from IncomingMessage", async () => {
  const exporter = new InMemorySpanExporter();
  const sdk = new BunSDK({ spanProcessor: new SimpleSpanProcessor(exporter) });
  sdk.start();

  // ... make request with User-Agent header ...

  const spans = exporter.getFinishedSpans();
  expect(spans[0].attributes["http.user_agent"]).toBe("TestAgent/1.0");
});
```

## Writing New Tests

### When to add a core test

- Adding new telemetry insertion points
- Adding new callback parameters
- Testing that callbacks are invoked at the right time

### When to add a bun-otel test

- Adding new span attributes
- Changing header extraction logic
- Adding trace context handling
- Testing error scenarios with spans

## Migration History

Previously, tests were mixed. The refactoring separated them:
- **Deleted:** `test/js/bun/http/telemetry-headers.test.ts` (was testing OTel behavior in core)
- **Split:** `packages/bun-otel/index.test.ts` → multiple focused test files
- **Clarified:** Core tests now only test insertion points
