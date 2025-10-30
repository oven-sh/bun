/**
 * Regression test for issue #3775
 * https://github.com/oven-sh/bun/issues/3775
 *
 * Original Issue:
 * "OpenTelemetry doesn't seem to work on Bun 0.7.0"
 * - OTel auto-instrumentation failed with Bun.serve()
 * - AsyncLocalStorage context propagation broken
 * - No spans exported to collectors
 *
 * Root Cause:
 * - Bun lacked native hooks for HTTP server instrumentation
 * - AsyncLocalStorage didn't work correctly with Bun.serve() handlers
 * - OTel's monkey-patching approach incompatible with Bun runtime
 *
 * Fix (PR #24063 - OpenTelemetry Support):
 * - Added native Zig hooks for Bun.serve() instrumentation
 * - Implemented AsyncLocalStorage-based context propagation
 * - Created BunSDK as drop-in replacement for NodeSDK
 *
 * Why is this here (and not in test/regression/issue/)?
 *  - the regression isn't fixed until bun-otel is imported
 *  - regression tests have no dependencies outside Bun core, this does
 *  - bun-otel is a first-party package, so it's acceptable
 *
 * This test verifies the fix works correctly.
 */
import { trace } from "@opentelemetry/api";
import { describe, expect, test } from "bun:test";
import { TestSDK, beforeUsingEchoServer, afterUsingEchoServer } from "./test-utils";
import { beforeAll } from "bun:test";
import { afterAll } from "bun:test";

describe("issue #3775 - OpenTelemetry with Bun.serve()", () => {
  beforeAll(beforeUsingEchoServer);
  afterAll(afterUsingEchoServer);
  test("BunSDK instruments Bun.serve() and exports spans", async () => {
    await using sdk = new TestSDK();

    // Create HTTP server (the failing case from original issue)
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/test") {
          // Simulate some async work
          await Bun.sleep(5);
          return new Response("OK", { status: 200 });
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    // Make request that should be traced (uninstrumented to avoid extra client span)
    const response = await sdk.echoServerFetch(`http://localhost:${server.port}/test`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");

    // Wait for spans to be exported (original issue: no spans exported)
    const [serverSpan] = await sdk.waitForSpans(1, s => s.server());
    expect(serverSpan).toBeDefined();
    expect(serverSpan).toHaveAttribute("http.request.method", "GET");
    expect(serverSpan).toHaveAttribute("url.path", "/test");
    expect(serverSpan).toHaveAttribute("http.response.status_code", 200);
  });

  test("AsyncLocalStorage context propagation works with Bun.serve()", async () => {
    await using sdk = new TestSDK();

    let activeSpanWasDefined = false;
    let capturedTraceId: string | undefined;
    let capturedSpanId: string | undefined;

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Get active span from AsyncLocalStorage context
        // Original issue: this would be undefined due to broken context propagation
        const activeSpan = trace.getActiveSpan();

        // Capture results to verify after request completes
        activeSpanWasDefined = activeSpan !== undefined;
        if (activeSpan) {
          const ctx = activeSpan.spanContext();
          capturedTraceId = ctx.traceId;
          capturedSpanId = ctx.spanId;
        }

        return new Response("OK");
      },
    });

    const response = await sdk.echoServerFetch(`http://localhost:${server.port}/`);
    expect(response.status).toBe(200);

    // Wait for server span
    const [serverSpan] = await sdk.waitForSpans(1, s => s.server());
    expect(serverSpan).toBeDefined();

    // Verify trace.getActiveSpan() returned the server span (not undefined)
    expect(activeSpanWasDefined).toBe(true);
    expect(capturedTraceId).toBe(serverSpan.spanContext().traceId);
    expect(capturedSpanId).toBe(serverSpan.spanContext().spanId);
  });

  test("outgoing fetch calls from server handlers create client spans", async () => {
    await using sdk = new TestSDK();

    // Create a simple echo server to fetch from
    using echoServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response("echo-response");
      },
    });

    // Create server that makes outgoing fetch
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Make outgoing fetch call (original issue: fetch not instrumented)
        const response = await fetch(`http://localhost:${echoServer.port}/`);
        return new Response(await response.text());
      },
    });

    const response = await sdk.echoServerFetch(`http://localhost:${server.port}/`);
    expect(await response.text()).toBe("echo-response");

    // Should have:
    // 1. Server span for main handler
    // 2. Client span for outgoing fetch (from server handler)
    // 3. Server span for echo handler
    const serverSpans = await sdk.waitForSpans(2, s => s.server());
    const clientSpans = await sdk.waitForSpans(1, s => s.client());

    expect(serverSpans.length).toBe(2);
    expect(clientSpans.length).toBe(1);

    // All spans should share the same trace ID (basic distributed tracing)
    const traceId = serverSpans[0].spanContext().traceId;
    expect(serverSpans[1].spanContext().traceId).toBe(traceId);
    expect(clientSpans[0].spanContext().traceId).toBe(traceId);
  });
});
