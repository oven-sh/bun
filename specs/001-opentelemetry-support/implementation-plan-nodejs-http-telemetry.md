# Implementation Plan: Node.js HTTP Server Telemetry Integration

**Feature**: OpenTelemetry Support for Bun
**Component**: Node.js `http.createServer()` compatibility layer telemetry
**Status**: Implementation Ready
**Created**: 2025-10-23

---

## Executive Summary

This plan details the integration of telemetry hooks into `src/js/node/_http_server.ts` based on the POC implementation and updated architectural specifications. The integration enables automatic span creation for Node.js HTTP servers without requiring an internal TypeScript bridge module.

**Key Architectural Decision** (from spec.md clarification, 2025-10-21):

> Node.js HTTP compatibility layer (`src/js/node/_http_server.ts`) calls `Bun.telemetry` native hooks directly at key lifecycle points (request arrival, writeHead, response end). TypeScript instrumentation packages (e.g., `packages/bun-otel/src/instruments/BunHttpInstrumentation.ts`) register via `Bun.telemetry.attach()` to receive these hooks. No internal TypeScript bridge module is required - instrumentation lives in user-loadable packages that only load when explicitly imported.

This approach ensures **CON-024 through CON-030** (zero startup cost when telemetry not used).

Overall guidance: Smallest diff possible in existing bun code

---

## References to Authoritative Sources

### POC Implementation

- **File**: `/Users/jacob.dilles/github/worktree/bun-fork-old/src/js/internal/telemetry_http.ts` (commit `199cc2306e`)
- **File**: `/Users/jacob.dilles/github/worktree/bun-fork-old/src/js/node/_http_server.ts` (commit `199cc2306e`)
- **Pattern**: Internal bridge module calling `Bun.telemetry.nativeHooks`

### Updated Architecture (Corrected Specs)

- **Contract**: `specs/001-opentelemetry-support/contracts/bun-telemetry-api.md`
- **Contract**: `specs/001-opentelemetry-support/contracts/hook-lifecycle.md`
- **Constraints**: `specs/001-opentelemetry-support/constraints.md` (CON-024 through CON-030)
- **Spec**: `specs/001-opentelemetry-support/spec.md` (FR-001, FR-012, FR-022)

### Key Difference from POC

The POC used an internal bridge module (`internal/telemetry_http.ts`) that lived in `src/js/internal/`, which would be loaded on every startup. The corrected architecture **eliminates this internal module** and instead:

1. `_http_server.ts` calls `Bun.telemetry` native API directly
2. `packages/bun-otel/src/instruments/BunHttpInstrumentation.ts` receives callbacks via `onOperationStart`, `onOperationEnd`, `onOperationError`
3. Zero startup cost when `bun-otel` package is not imported

---

## Implementation Steps

### Step 1: Create Direct Native Hook Calls in `_http_server.ts`

**File**: `/Users/jacob.dilles/github/bun-fork/src/js/node/_http_server.ts`

**Locations to Modify**:

#### 1a. Request Arrival Hook (Line ~556)

**Location**: Inside `onNodeHTTPRequest` callback, after `ServerResponse` is created

**Current Code** (lines 551-562):

```typescript
const http_res = new ResponseClass(http_req, {
  [kHandle]: handle,
  [kRejectNonStandardBodyWrites]: server.rejectNonStandardBodyWrites,
});

// Telemetry: notify about incoming request
try {
  telemetryHttp.handleIncomingRequest(http_req, http_res);
} catch {
  // Telemetry failures should not crash the request path
}
```

**New Implementation**:

```typescript
const http_res = new ResponseClass(http_req, {
  [kHandle]: handle,
  [kRejectNonStandardBodyWrites]: server.rejectNonStandardBodyWrites,
});

const otel = Bun?.telemetry?.nativeHooks();
if (otel) {
  try {
    const op_id = otel.generateId();
    http_req.telemetry_op_id = op_id;
    http_res.telemetry_op_id = op_id;
    //  FR-001 - create spans, instrument with .once
    otel.notifyOperationStart(1 /** .http **/, op_id, [http_req, http_res]);
  } catch {
    /* (FR-022) do not crash */
  }
}
```

**Justification**:

- **Contract**: `hook-lifecycle.md` lines 63-90 specify `onOperationStart` receives HTTP attributes
- **POC Pattern**: POC's `telemetryHttp.handleIncomingRequest()` at lines 196-232 shows operation ID generation and `notifyStart()` call
- **Constraint**: CON-025 requires direct native calls, not TypeScript bridge modules
- **Spec**: FR-001 requires automatic span creation for both Bun.serve and Node.js http

#### 1b. Remove all other touchpoints

**Justification**:

- **Contract**: `hook-lifecycle.md` lines 63-90 specify `onOperationStart` receives HTTP attributes
- **POC Pattern**: POC's `telemetryHttp.handleIncomingRequest()` at lines 196-232 shows operation ID generation and `notifyStart()` call
- **Constraint**: CON-002 requires minimal instrumentation blocks. All semantics can be preserved via
- **Spec**: FR-001 requires automatic span creation for both Bun.serve and Node.js http

---

### Step 2: Remove Internal Bridge Module Requirement

**Action**: Do NOT create `src/js/internal/telemetry_http.ts` in the current codebase

**Justification**:

- **Constraint**: CON-024 forbids internal TypeScript modules for telemetry
- **Constraint**: CON-025 requires direct native calls from internal modules
- **Constraint**: CON-026 requires instrumentation packages only load when imported

The POC implementation used an internal bridge module because the architecture had not yet been finalized. The corrected architecture eliminates this module entirely.

---

### Step 3: Native Layer API Implementation (Zig)

**File**: `src/telemetry/main.zig` (already exists)

**Required Native Functions** (to be exported to JavaScript):

```zig
// These functions will be callable from TypeScript as:
// - Bun.telemetry.nativeHooks()?.notifyHttpRequestStart(req, res)

pub fn notifyHttpRequestStart(
    globalObject: *JSC.JSGlobalObject,
    req: JSC.JSValue, // IncomingMessage
    res: JSC.JSValue, // ServerResponse
) callconv(.C) void {
    // 1. Check if HTTP instrumentation enabled (fast path)
    if (!isEnabledFor(.http)) return;

    // 2. Generate unique operation ID (monotonic counter, FR-032)
    const opId = generateOperationId();

    // 3. Store opId on response object for later retrieval
    // Use private symbol to avoid user code interference
    storeOperationId(res, opId);

    // 4. Extract HTTP attributes from IncomingMessage
    var attrs = AttributeMap.init(allocator);
    defer attrs.deinit();

    // Extract method, URL, headers, traceparent
    // See hook-lifecycle.md lines 68-90 for attribute list
    extractHttpRequestAttributes(&attrs, req, opId);

    // 5. Notify all registered HTTP instrumentations
    notifyOperationStart(.http, opId, attrs.toJS(globalObject));
}
```

**Justification**:

- **Contract**: `bun-telemetry-api.md` lines 54-59 specify hook signatures
- **POC Pattern**: POC's `nativeHooks` is now a function (not object) that returns hooks object or undefined for zero-cost abstraction when disabled
- **Constraint**: CON-013 requires silent failure on OOM (no errors to caller)

---

### Step 4: Attribute Extraction Helpers (Zig)

**File**: `src/telemetry/attributes.zig` (to be created)

**Purpose**: Extract HTTP semantic convention attributes from JavaScript objects

```zig
/// Extract HTTP request attributes per OpenTelemetry semantic conventions v1.23.0+
/// Reference: hook-lifecycle.md lines 68-90
pub fn extractHttpRequestAttributes(
    attrs: *AttributeMap,
    req: JSC.JSValue, // IncomingMessage
    opId: u64,
) void {
    // Common attributes
    attrs.put("operation.id", JSC.JSValue.jsNumber(opId));
    attrs.put("operation.timestamp", JSC.JSValue.jsNumber(std.time.nanoTimestamp()));

    // HTTP method
    const method = req.get(globalObject, "method") orelse JSC.JSValue.jsNull();
    if (method.isString()) {
        attrs.put("http.request.method", method);
    }

    // URL components (parse from req.url and req.headers.host)
    const url = req.get(globalObject, "url") orelse JSC.JSValue.jsNull();
    const headers = req.get(globalObject, "headers") orelse JSC.JSValue.jsNull();
    if (url.isString() and headers.isObject()) {
        // Extract scheme (http vs https from socket.encrypted)
        const socket = req.get(globalObject, "socket") orelse JSC.JSValue.jsNull();
        const encrypted = if (socket.isObject())
            socket.get(globalObject, "encrypted") orelse JSC.JSValue.jsBoolean(false)
        else
            JSC.JSValue.jsBoolean(false);
        const scheme = if (encrypted.toBoolean()) "https" else "http";
        attrs.put("url.scheme", JSC.JSValue.jsString(scheme));

        // Get host header
        const host = headers.get(globalObject, "host") orelse JSC.JSValue.jsNull();
        const hostStr = if (host.isString()) host.toString() else "localhost";
        attrs.put("server.address", JSC.JSValue.jsString(hostStr));

        // Parse URL path and query
        const urlStr = url.toString();
        const fullUrl = std.fmt.allocPrint(allocator, "{s}://{s}{s}", .{ scheme, hostStr, urlStr }) catch return;
        defer allocator.free(fullUrl);

        attrs.put("url.full", JSC.JSValue.jsString(fullUrl));

        // Split path and query
        if (std.mem.indexOf(u8, urlStr, "?")) |qIdx| {
            attrs.put("url.path", JSC.JSValue.jsString(urlStr[0..qIdx]));
            attrs.put("url.query", JSC.JSValue.jsString(urlStr[qIdx + 1 ..]));
        } else {
            attrs.put("url.path", JSC.JSValue.jsString(urlStr));
        }

        // Parse port from host header
        if (std.mem.indexOf(u8, hostStr, ":")) |portIdx| {
            const portStr = hostStr[portIdx + 1 ..];
            const port = std.fmt.parseInt(u32, portStr, 10) catch 0;
            if (port > 0) {
                attrs.put("server.port", JSC.JSValue.jsNumber(port));
            }
        }
    }

    // Extract traceparent header for distributed tracing
    // Reference: hook-lifecycle.md lines 84-89
    const traceparent = headers.get(globalObject, "traceparent") orelse JSC.JSValue.jsNull();
    if (traceparent.isString()) {
        const tpStr = traceparent.toString();
        // Parse W3C traceparent format: "00-{trace_id}-{span_id}-{flags}"
        var iter = std.mem.split(u8, tpStr, "-");
        if (iter.next()) |_version| { // Skip version
            if (iter.next()) |traceId| {
                attrs.put("trace.parent.trace_id", JSC.JSValue.jsString(traceId));
            }
            if (iter.next()) |spanId| {
                attrs.put("trace.parent.span_id", JSC.JSValue.jsString(spanId));
            }
            if (iter.next()) |flagsStr| {
                const flags = std.fmt.parseInt(u8, flagsStr, 16) catch 0;
                attrs.put("trace.parent.trace_flags", JSC.JSValue.jsNumber(flags));
            }
        }
    }

    // Extract tracestate header
    const tracestate = headers.get(globalObject, "tracestate") orelse JSC.JSValue.jsNull();
    if (tracestate.isString()) {
        attrs.put("trace.parent.trace_state", tracestate);
    }

    // Capture configured request headers
    // Reference: bun-telemetry-api.md lines 35-39
    const capturedHeaders = getCaptureHeadersServerRequest(); // From instrument config
    for (capturedHeaders) |headerName| {
        const headerValue = headers.get(globalObject, headerName) orelse continue;
        if (headerValue.isString()) {
            const attrName = std.fmt.allocPrint(allocator, "http.request.header.{s}", .{headerName}) catch continue;
            defer allocator.free(attrName);
            attrs.put(attrName, headerValue);
        }
    }
}

/// Extract HTTP response attributes
/// Reference: hook-lifecycle.md lines 120-127
pub fn extractHttpResponseAttributes(
    attrs: *AttributeMap,
    res: JSC.JSValue, // ServerResponse
    opId: u64,
) void {
    attrs.put("operation.id", JSC.JSValue.jsNumber(opId));

    // Get status code
    const statusCode = res.get(globalObject, "statusCode") orelse JSC.JSValue.jsNumber(200);
    attrs.put("http.response.status_code", statusCode);

    // Calculate duration (requires stored start time)
    const startTime = retrieveStartTime(res) orelse 0;
    if (startTime > 0) {
        const duration = std.time.nanoTimestamp() - startTime;
        attrs.put("operation.duration", JSC.JSValue.jsNumber(duration));
    }

    // Extract content-length from headers
    const headers = res.get(globalObject, "_headers") orelse JSC.JSValue.jsNull();
    if (headers.isObject()) {
        const contentLength = headers.get(globalObject, "content-length") orelse JSC.JSValue.jsNull();
        if (contentLength.isString()) {
            const sizeStr = contentLength.toString();
            const size = std.fmt.parseInt(u64, sizeStr, 10) catch 0;
            if (size > 0) {
                attrs.put("http.response.body.size", JSC.JSValue.jsNumber(size));
            }
        }
    }

    // Capture configured response headers
    const capturedHeaders = getCaptureHeadersServerResponse();
    for (capturedHeaders) |headerName| {
        if (!headers.isObject()) break;
        const headerValue = headers.get(globalObject, headerName) orelse continue;
        if (headerValue.isString()) {
            const attrName = std.fmt.allocPrint(allocator, "http.response.header.{s}", .{headerName}) catch continue;
            defer allocator.free(attrName);
            attrs.put(attrName, headerValue);
        }
    }
}

/// Extract error attributes
/// Reference: hook-lifecycle.md lines 140-147
pub fn extractHttpErrorAttributes(
    attrs: *AttributeMap,
    res: JSC.JSValue, // ServerResponse
    errorType: JSC.JSValue, // Optional string
    opId: u64,
) void {
    attrs.put("operation.id", JSC.JSValue.jsNumber(opId));

    // Error type (from parameter or default)
    if (errorType.isString()) {
        attrs.put("error.type", errorType);
    } else {
        attrs.put("error.type", JSC.JSValue.jsString("UnknownError"));
    }

    // Generic error message
    attrs.put("error.message", JSC.JSValue.jsString("HTTP request failed"));

    // Calculate duration
    const startTime = retrieveStartTime(res) orelse 0;
    if (startTime > 0) {
        const duration = std.time.nanoTimestamp() - startTime;
        attrs.put("operation.duration", JSC.JSValue.jsNumber(duration));
    }

    // Include status code if set
    const statusCode = res.get(globalObject, "statusCode") orelse JSC.JSValue.jsNull();
    if (statusCode.isNumber()) {
        attrs.put("http.response.status_code", statusCode);
    }
}
```

**Justification**:

- **Contract**: `hook-lifecycle.md` lines 68-147 specify all attribute names and types
- **Spec**: FR-004 requires OpenTelemetry HTTP semantic conventions
- **Constraint**: CON-007 requires stack-allocated AttributeMap with no cleanup

---

### Step 5: Operation ID Storage on ServerResponse

**Mechanism**: Store operation ID and start time on ServerResponse object using JavaScript private symbols

**Implementation Pattern** (in Zig):

```zig
// Define private symbols for storage (one-time initialization)
var opIdSymbol: JSC.JSValue = undefined;
var startTimeSymbol: JSC.JSValue = undefined;

pub fn initializeSymbols(globalObject: *JSC.JSGlobalObject) void {
    opIdSymbol = JSC.JSValue.createSymbol(globalObject, "[[OperationId]]");
    startTimeSymbol = JSC.JSValue.createSymbol(globalObject, "[[StartTime]]");
}

pub fn storeOperationId(res: JSC.JSValue, opId: u64) void {
    res.put(globalObject, opIdSymbol, JSC.JSValue.jsNumber(@intToFloat(f64, opId)));
    res.put(globalObject, startTimeSymbol, JSC.JSValue.jsNumber(std.time.nanoTimestamp()));
}

pub fn retrieveOperationId(res: JSC.JSValue) ?u64 {
    const value = res.get(globalObject, opIdSymbol) orelse return null;
    if (!value.isNumber()) return null;
    return @floatToInt(u64, value.asNumber());
}

pub fn retrieveStartTime(res: JSC.JSValue) ?i128 {
    const value = res.get(globalObject, startTimeSymbol) orelse return null;
    if (!value.isNumber()) return null;
    return @floatToInt(i128, value.asNumber());
}

pub fn clearOperationId(res: JSC.JSValue) void {
    res.delete(globalObject, opIdSymbol);
    res.delete(globalObject, startTimeSymbol);
}
```

**Justification**:

- **POC Pattern**: POC used TypeScript symbols (`kOperationId`, `kStartTime`, `kHeadersEmitted`) at lines 15-17
- **Constraint**: CON-008 requires AttributeMap valid only for call duration (no ownership transfer)
- **Spec**: FR-032 requires monotonic operation IDs

---

### Step 6: Integration Flow Verification

**Data Flow** (from `_http_server.ts` → Native → `BunHttpInstrumentation`):

1. **Request Arrives** (line ~556):

   ```
   _http_server.ts: Bun.telemetry.notifyHttpRequestStart(req, res)
       ↓
   Zig (main.zig): notifyHttpRequestStart()
       - Generate opId
       - Extract attributes (method, URL, headers, traceparent)
       - Store opId on response object
       ↓
   Zig (registry.zig): notifyOperationStart(HTTP, opId, attributes)
       - Loop through all registered HTTP instruments
       - Call each instrument's onOperationStart callback
       ↓
   TypeScript (BunHttpInstrumentation.ts): onOperationStart(id, attributes)
       - Extract parent context from attributes["trace.parent.*"]
       - Create SERVER span with tracer.startSpan()
       - Store span in this._activeSpans.set(id, span)
   ```

2. **Response Headers Sent** (line ~1204):

   ```
   _http_server.ts: Bun.telemetry.notifyHttpResponseHeaders(res, statusCode)
       ↓
   Zig (main.zig): notifyHttpResponseHeaders()
       - Retrieve opId from response object
       ↓
   Zig (registry.zig): notifyOperationInject(HTTP, opId, null)
       - Call each instrument's onOperationInject callback
       - Collect returned header objects
       ↓
   TypeScript (BunHttpInstrumentation.ts): onOperationInject(id, data)
       - Retrieve span from this._activeSpans.get(id)
       - Extract span context (traceId, spanId, traceFlags)
       - Return ["00-{traceId}-{spanId}-{flags}", "{tracestate}"]
       ↓
   Zig (main.zig): Convert array to { "traceparent": "...", "tracestate": "..." }
       - Return JS object to TypeScript
       ↓
   _http_server.ts: Apply injected headers to response
   ```

3. **Response Completes** (line ~1393):

   ```
   _http_server.ts: Bun.telemetry.notifyHttpRequestEnd(res)
       ↓
   Zig (main.zig): notifyHttpRequestEnd()
       - Retrieve opId from response object
       - Extract response attributes (status, content-length, duration)
       - Clear opId from response object
       ↓
   Zig (registry.zig): notifyOperationEnd(HTTP, opId, attributes)
       ↓
   TypeScript (BunHttpInstrumentation.ts): onOperationEnd(id, attributes)
       - Retrieve span from this._activeSpans.get(id)
       - Set attributes (status_code, body_size)
       - Set span status based on status code
       - Call span.end()
       - Delete from this._activeSpans
   ```

4. **Error Occurs**:
   ```
   _http_server.ts: Bun.telemetry.notifyHttpRequestError(res, "TimeoutError")
       ↓
   Zig (main.zig): notifyHttpRequestError()
       - Retrieve opId from response object
       - Extract error attributes
       - Clear opId from response object
       ↓
   Zig (registry.zig): notifyOperationError(HTTP, opId, attributes)
       ↓
   TypeScript (BunHttpInstrumentation.ts): onOperationError(id, attributes)
       - Retrieve span from this._activeSpans.get(id)
       - Record exception on span
       - Set span status to ERROR
       - Call span.end()
       - Delete from this._activeSpans
   ```

**Justification**:

- **Contract**: `hook-lifecycle.md` lines 206-225 specify state machine and guarantees
- **POC Pattern**: POC flow at lines 196-232 (start), 258-275 (progress), 162-168 (end), 170-185 (error)
- **Spec**: FR-001 requires automatic span creation

---

### Step 7: Error Handling Strategy

**Defensive Programming Pattern**:

```typescript
// In _http_server.ts, all telemetry calls wrapped in try-catch
if (typeof Bun !== "undefined" && Bun.telemetry?.notifyHttpRequestStart) {
  try {
    Bun.telemetry.notifyHttpRequestStart(http_req, http_res);
  } catch {
    // FR-022: Catch exceptions, native layer logs to stderr
    // Request processing continues normally
  }
}
```

**Native Layer Error Handling** (Zig):

```zig
pub fn notifyHttpRequestStart(
    globalObject: *JSC.JSGlobalObject,
    req: JSC.JSValue,
    res: JSC.JSValue,
) callconv(.C) void {
    // CON-013: Silent failure on OOM
    const opId = generateOperationId() catch {
        // Log error to stderr
        std.debug.print("[Telemetry] Failed to generate operation ID: OOM\n", .{});
        return; // Silently fail
    };

    var attrs = AttributeMap.init(allocator) catch {
        std.debug.print("[Telemetry] Failed to allocate AttributeMap: OOM\n", .{});
        return;
    };
    defer attrs.deinit();

    extractHttpRequestAttributes(&attrs, req, opId); // Best-effort extraction

    // Hook invocation errors caught by registry layer
    notifyOperationStart(.http, opId, attrs.toJS(globalObject));
}
```

**Instrumentation Hook Error Handling** (in registry):

```zig
// In registry.zig notifyOperationStart()
for (instruments) |instrument| {
    const result = callJSFunction(instrument.onOperationStart, opId, attributes);
    if (result.isException()) {
        // FR-022: Log exception with rate limiting
        const exception = result.asException();
        std.debug.print(
            "[Telemetry] Error in onOperationStart ({s} v{s}): {s}\n",
            .{ instrument.name, instrument.version, exception.message },
        );
        // Clear exception and continue to next instrument
        globalObject.clearException();
    }
}
```

**Justification**:

- **Spec**: FR-022 requires defensive error handling with stderr logging and rate limiting
- **Constraint**: CON-013 requires silent OOM failure
- **Contract**: `bun-telemetry-api.md` lines 224-236 specify error format and behavior

---

### Step 8: Testing Strategy

**Test File Locations**:

1. **Native Hook Tests**: `test/js/bun/telemetry/node-http-server.test.ts`
   - Test that `Bun.telemetry.attach({ type: "http", ... })` receives callbacks
   - Verify attribute structure matches semantic conventions
   - Test error scenarios (malformed headers, OOM, exceptions)
   - NO OpenTelemetry SDK imports (per hook-lifecycle.md lines 486-520)

2. **Integration Tests**: `packages/bun-otel/test/BunHttpInstrumentation.test.ts`
   - Test full span creation with OpenTelemetry SDK
   - Verify distributed tracing propagation
   - Test header injection
   - CAN import OpenTelemetry SDK (per hook-lifecycle.md lines 523-555)

**Example Native Hook Test**:

```typescript
import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Node.js http.createServer() triggers onOperationStart", async () => {
  using dir = tempDir("http-telemetry", {
    "server.js": `
      const http = require("http");

      let capturedAttrs;
      Bun.telemetry.attach({
        type: "http",
        name: "test-instrument",
        version: "1.0.0",
        onOperationStart(id, attributes) {
          capturedAttrs = attributes;
        },
      });

      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("OK");

        // Log attributes for verification
        console.log(JSON.stringify(capturedAttrs));
        server.close();
      });

      server.listen(0, () => {
        const port = server.address().port;
        fetch(\`http://localhost:\${port}/test?foo=bar\`);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
  });

  const output = await proc.stdout.text();
  const attrs = JSON.parse(output.trim());

  // Verify OpenTelemetry HTTP semantic conventions
  expect(attrs).toMatchObject({
    "http.request.method": "GET",
    "url.path": "/test",
    "url.query": "foo=bar",
    "operation.id": expect.any(Number),
    "operation.timestamp": expect.any(Number),
  });

  expect(await proc.exited).toBe(0);
});

test("Node.js http response headers trigger onOperationEnd", async () => {
  using dir = tempDir("http-telemetry-end", {
    "server.js": `
      const http = require("http");

      let capturedEndAttrs;
      Bun.telemetry.attach({
        type: "http",
        name: "test-instrument",
        version: "1.0.0",
        onOperationEnd(id, attributes) {
          capturedEndAttrs = attributes;
        },
      });

      const server = http.createServer((req, res) => {
        res.writeHead(201, { "Content-Type": "text/plain" });
        res.end("Created");

        setTimeout(() => {
          console.log(JSON.stringify(capturedEndAttrs));
          server.close();
        }, 10);
      });

      server.listen(0, () => {
        const port = server.address().port;
        fetch(\`http://localhost:\${port}/resource\`);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
  });

  const output = await proc.stdout.text();
  const attrs = JSON.parse(output.trim());

  expect(attrs).toMatchObject({
    "http.response.status_code": 201,
    "operation.duration": expect.any(Number),
  });

  expect(await proc.exited).toBe(0);
});

test("Node.js http error triggers onOperationError", async () => {
  using dir = tempDir("http-telemetry-error", {
    "server.js": `
      const http = require("http");

      let capturedErrorAttrs;
      Bun.telemetry.attach({
        type: "http",
        name: "test-instrument",
        version: "1.0.0",
        onOperationError(id, attributes) {
          capturedErrorAttrs = attributes;
        },
      });

      const server = http.createServer((req, res) => {
        // Simulate timeout error
        res.emit("timeout");

        setTimeout(() => {
          console.log(JSON.stringify(capturedErrorAttrs));
          server.close();
        }, 10);
      });

      server.listen(0, () => {
        const port = server.address().port;
        fetch(\`http://localhost:\${port}/\`).catch(() => {});
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
  });

  const output = await proc.stdout.text();
  const attrs = JSON.parse(output.trim());

  expect(attrs).toMatchObject({
    "error.type": "TimeoutError",
    "error.message": expect.any(String),
    "operation.duration": expect.any(Number),
  });

  expect(await proc.exited).toBe(0);
});
```

**Justification**:

- **Contract**: `hook-lifecycle.md` lines 486-555 specify testing contract
- **Spec**: FR-022 requires error handling verification
- **CLAUDE.md**: Use `tempDir`, `bunExe()`, `bunEnv`, verify test fails with `USE_SYSTEM_BUN=1`

---

## Expected Behavior Summary

### What Happens When User Imports `bun-otel`

```typescript
// user-app.ts
import { BunHttpInstrumentation } from "bun-otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
provider.register();

const instrumentation = new BunHttpInstrumentation({
  captureAttributes: {
    requestHeaders: ["user-agent", "content-type"],
    responseHeaders: ["content-type"],
  },
});
instrumentation.setTracerProvider(provider);
instrumentation.enable(); // ← Calls Bun.telemetry.attach({ type: "http", ... })

// Now start HTTP server
const http = require("http");
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello World");
  })
  .listen(3000);
```

**Execution Flow**:

1. `instrumentation.enable()` calls `Bun.telemetry.attach({ type: "http", onOperationStart, onOperationEnd, ... })`
2. Zig registers instrument in native registry
3. First request arrives → `_http_server.ts` calls `Bun.telemetry.notifyHttpRequestStart(req, res)`
4. Zig extracts attributes and calls `BunHttpInstrumentation.onOperationStart(id, attributes)`
5. `BunHttpInstrumentation` creates span, stores in `_activeSpans`
6. Response headers sent → `_http_server.ts` calls `Bun.telemetry.notifyHttpResponseHeaders(res, statusCode)`
7. Zig calls `BunHttpInstrumentation.onOperationInject(id)` → returns `["00-{traceId}-{spanId}-01", ""]`
8. Zig converts to `{ "traceparent": "...", "tracestate": "" }` and returns to TypeScript
9. `_http_server.ts` injects headers into response
10. Response completes → `_http_server.ts` calls `Bun.telemetry.notifyHttpRequestEnd(res)`
11. Zig calls `BunHttpInstrumentation.onOperationEnd(id, attributes)`
12. `BunHttpInstrumentation` updates span attributes, calls `span.end()`, deletes from `_activeSpans`
13. Span exported to console

### What Happens When User Does NOT Import `bun-otel`

```typescript
// user-app.ts (no OpenTelemetry imports)
const http = require("http");
http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("Hello");
  })
  .listen(3000);
```

**Execution Flow**:

1. No `Bun.telemetry.attach()` calls → native registry empty
2. First request arrives → `_http_server.ts` calls `Bun.telemetry.notifyHttpRequestStart(req, res)`
3. Zig checks `isEnabledFor(.http)` → returns `false` (no instruments registered)
4. **Immediate return, ~7ns overhead** (per hook-lifecycle.md line 335)
5. No attribute extraction, no hook invocation, zero allocation
6. Request proceeds normally with <0.1% overhead (SC-004)

**Justification**:

- **Constraint**: CON-001 through CON-004 require zero-cost abstraction
- **Constraint**: CON-024 through CON-026 require instrumentation in user-loadable packages
- **Contract**: `hook-lifecycle.md` lines 330-356 specify overhead targets

---

## Files Modified and Created

### Files Modified

1. **`/Users/jacob.dilles/github/bun-fork/src/js/node/_http_server.ts`**
   - Line ~556: Add `notifyHttpRequestStart()` call
   - Line ~603: Add error listeners with `notifyHttpRequestError()`
   - Line ~1204: Add `notifyHttpResponseHeaders()` call with header injection
   - Line ~1393: Add `notifyHttpRequestEnd()` call

### Files Created

1. **`/Users/jacob.dilles/github/bun-fork/src/telemetry/attributes.zig`**
   - HTTP attribute extraction helpers
   - `extractHttpRequestAttributes()`
   - `extractHttpResponseAttributes()`
   - `extractHttpErrorAttributes()`

2. **`/Users/jacob.dilles/github/bun-fork/test/js/bun/telemetry/node-http-server.test.ts`**
   - Native hook tests (no OTel SDK)
   - Attribute structure verification
   - Error handling tests

### Files Already Exist (From Previous Implementation)

1. **`/Users/jacob.dilles/github/bun-fork/src/telemetry/main.zig`**
   - Add `notifyHttpRequestStart()`, `notifyHttpResponseHeaders()`, `notifyHttpRequestEnd()`, `notifyHttpRequestError()`
   - Add operation ID storage helpers

2. **`/Users/jacob.dilles/github/bun-fork/packages/bun-otel/src/instruments/BunHttpInstrumentation.ts`**
   - Already implemented (as shown in earlier file read)
   - Handles both Bun.serve and Node.js http.createServer via same hooks

---

## Success Criteria

### Functional

- [ ] Node.js `http.createServer()` requests trigger `onOperationStart` with correct attributes
- [ ] Response completion triggers `onOperationEnd` with status code, duration, body size
- [ ] Errors trigger `onOperationError` with error type and message
- [ ] Distributed tracing headers (traceparent) extracted from request
- [ ] Response headers injected via `onOperationInject`
- [ ] Multiple instrumentations receive callbacks in registration order
- [ ] Test suite passes: `bun bd test test/js/bun/telemetry/node-http-server.test.ts`

### Performance

- [ ] Overhead when disabled: <0.1% (measured with `oha` or `bombardier`, per spec.md line 29)
- [ ] Overhead when enabled: <5% (measured with `oha` or `bombardier`)
- [ ] No memory leaks with 100k requests (validate with `process.memoryUsage()`)

### Error Handling

- [ ] Hook exceptions logged to stderr, request proceeds normally
- [ ] Malformed traceparent headers handled gracefully (attributes omitted)
- [ ] OOM in native layer silently fails (logs to stderr)
- [ ] Test verification: `USE_SYSTEM_BUN=1 bun test` fails, `bun bd test` passes

---

## Notes and Caveats

### Difference from POC

The POC implementation created `src/js/internal/telemetry_http.ts` as a bridge module. This is **NOT NEEDED** in the final implementation because:

1. The bridge module would be loaded on every startup (violates CON-024)
2. Direct native calls from `_http_server.ts` are cleaner and more efficient
3. Instrumentation packages (`bun-otel`) only load when explicitly imported

### Shared Instrumentation for Bun.serve and Node.js http

The `BunHttpInstrumentation` class handles **both** native `Bun.serve()` and Node.js `http.createServer()` because:

1. Both use the same `Bun.telemetry.attach({ type: "http", ... })` registration
2. Native layer provides sufficient context (Request/Response objects) for attribute extraction
3. Code reuse maximizes maintainability (CON-029, CON-030)

### AsyncLocalStorage Context Propagation

The POC already solved AsyncLocalStorage context propagation by having Zig control the initial stack frame. This implementation plan does NOT need to address this separately because:

1. `Bun.serve()` already creates AsyncLocalStorage frames (per hook-lifecycle.md lines 442-481)
2. Node.js `http.createServer()` can use the same mechanism
3. No workaround needed for `context.with()` wrapping

**Reference**: `hook-lifecycle.md` lines 442-481 document the POC solution.

---

## Implementation Checklist

- [ ] **Step 1**: Add native hook calls to `_http_server.ts` (4 locations)
- [ ] **Step 2**: Verify no internal bridge module created
- [ ] **Step 3**: Implement native Zig functions in `src/telemetry/main.zig`
- [ ] **Step 4**: Create `src/telemetry/attributes.zig` with extraction helpers
- [ ] **Step 5**: Implement operation ID storage on ServerResponse
- [ ] **Step 6**: Verify integration flow with manual testing
- [ ] **Step 7**: Add error handling and logging
- [ ] **Step 8**: Create test suite in `test/js/bun/telemetry/node-http-server.test.ts`
- [ ] **Verification**: Run `bun bd test test/js/bun/telemetry/node-http-server.test.ts`
- [ ] **Verification**: Confirm `USE_SYSTEM_BUN=1 bun test` fails (tests are not valid)
- [ ] **Verification**: Run performance benchmarks (`oha` or `bombardier`)
- [ ] **Verification**: Manual integration test with `packages/bun-otel` package

---

## References

**Authoritative Specs**:

- `/Users/jacob.dilles/github/bun-fork/specs/001-opentelemetry-support/contracts/bun-telemetry-api.md`
- `/Users/jacob.dilles/github/bun-fork/specs/001-opentelemetry-support/contracts/hook-lifecycle.md`
- `/Users/jacob.dilles/github/bun-fork/specs/001-opentelemetry-support/constraints.md`
- `/Users/jacob.dilles/github/bun-fork/specs/001-opentelemetry-support/spec.md`

**POC Implementation** (branch `feat/opentelemetry-server-hooks`):

- `/Users/jacob.dilles/github/worktree/bun-fork-old/src/js/internal/telemetry_http.ts` (commit `199cc2306e`)
- `/Users/jacob.dilles/github/worktree/bun-fork-old/src/js/node/_http_server.ts` (commit `199cc2306e`)

**Current Implementation**:

- `/Users/jacob.dilles/github/bun-fork/packages/bun-otel/src/instruments/BunHttpInstrumentation.ts` (already complete)
- `/Users/jacob.dilles/github/bun-fork/src/js/node/_http_server.ts` (to be modified)
- `/Users/jacob.dilles/github/bun-fork/src/telemetry/main.zig` (to be extended)

**OpenTelemetry Standards**:

- [HTTP Semantic Conventions v1.23.0+](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
- [W3C TraceContext Specification](https://www.w3.org/TR/trace-context/)

---

**End of Implementation Plan**
