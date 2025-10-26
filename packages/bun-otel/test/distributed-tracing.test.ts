import { context, SpanKind, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BunSDK } from "../index";
import { EchoServer } from "./echo-server";
import { waitForSpans } from "./test-utils";

/**
 * Tests trace propagation: uninstrumented client → UUT (Bun.serve) → fetch → echo server
 *
 * This verifies that Bun.serve properly extracts context from incoming traceparent,
 * creates a SERVER span, and propagates context to outgoing fetch CLIENT spans.
 */
describe("Distributed tracing with fetch propagation", () => {
  // Shared echo server for all tests - runs in separate process to avoid instrumentation
  let echoServer: EchoServer;

  // Start echo server once for all tests
  beforeAll(async () => {
    echoServer = new EchoServer();
    await echoServer.start();
  });

  // Shutdown echo server after all tests
  afterAll(async () => {
    await echoServer.stop();
  });

  test("context.active() returns the correct span synchronously in request handler", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "context-active-test",
    });

    sdk.start();

    let capturedTraceId: string | undefined;
    let capturedSpanId: string | undefined;

    using server = Bun.serve({
      port: 0,
      fetch() {
        // Synchronously check context.active() to verify span is available
        const activeSpan = trace.getSpan(context.active());
        capturedTraceId = activeSpan?.spanContext().traceId;
        capturedSpanId = activeSpan?.spanContext().spanId;
        return new Response("OK");
      },
    });

    const upstreamTraceId = "1234567890abcdef1234567890abcdef";
    const upstreamSpanId = "fedcba0987654321";
    const traceparent = `00-${upstreamTraceId}-${upstreamSpanId}-01`;

    // Use remote control to avoid instrumenting the test's own fetch
    await echoServer.remoteControl.fetch(`http://localhost:${server.port}/test`, { headers: { traceparent } });

    // Wait for the server span to be exported (scoped to our trace)
    await waitForSpans(exporter, 1, 1000, { traceId: upstreamTraceId });

    const spans = exporter
      .getFinishedSpans()
      .filter(s => s.kind === SpanKind.SERVER && s.spanContext().traceId === upstreamTraceId);
    expect(spans).toHaveLength(1);

    const serverSpan = spans[0];
    expect(serverSpan.kind).toBe(SpanKind.SERVER);

    // Verify that context.active() returned the correct span
    expect(capturedTraceId).toBe(upstreamTraceId);
    expect(capturedSpanId).toBe(serverSpan.spanContext().spanId);

    // Verify the span has the correct parent
    expect(serverSpan.parentSpanContext?.spanId).toBe(upstreamSpanId);
    expect(serverSpan.spanContext().traceId).toBe(upstreamTraceId);
  });

  test("propagates trace context from server A → fetch → server B", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "distributed-tracing-test",
      // Note: Don't specify instrumentations to auto-register BunHttpInstrumentation + BunFetchInstrumentation
    });

    sdk.start();

    // Server A - upstream service that makes fetch call to echo server
    using serverA = Bun.serve({
      port: 0,
      async fetch(req: Request) {
        // This fetch call should automatically inject traceparent from active span
        const response = await fetch(echoServer.getUrl("/downstream"));
        const data = await response.json();
        return Response.json({ downstream: data });
      },
    });

    // Make request to server A with a known trace context
    const upstreamTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const upstreamSpanId = "00f067aa0ba902b7";
    const traceparent = `00-${upstreamTraceId}-${upstreamSpanId}-01`;

    // Use remote control to avoid instrumenting the test's own fetch call
    const response = await echoServer.remoteControl.fetch(`http://localhost:${serverA.port}/upstream`, {
      headers: { traceparent },
    });
    const result = await response.json();

    // Wait for 2 spans: serverA (SERVER) + fetch to echoServer (CLIENT)
    // Note: Echo server runs in separate process, so we only see serverA's spans
    await waitForSpans(exporter, 2, 1000, { traceId: upstreamTraceId });

    const spans = exporter.getFinishedSpans().filter(s => s.spanContext().traceId === upstreamTraceId);
    expect(spans).toHaveLength(2);

    // With fetch instrumentation: serverA (SERVER), fetchClient (CLIENT)
    const serverASpan = spans.find(s => s.kind === SpanKind.SERVER)!;
    const fetchClientSpan = spans.find(s => s.kind === SpanKind.CLIENT)!;

    // CRITICAL ASSERTIONS for distributed tracing:

    // 1. Both spans should share the same trace ID (distributed trace)
    expect(serverASpan.spanContext().traceId).toBe(upstreamTraceId);
    expect(fetchClientSpan.spanContext().traceId).toBe(upstreamTraceId);

    // 2. Server A's span should be a child of the incoming request
    expect(serverASpan.parentSpanContext?.spanId).toBe(upstreamSpanId);

    // 3. Fetch CLIENT span should be a child of server A's span
    expect(fetchClientSpan.parentSpanContext?.spanId).toBe(serverASpan.spanContext().spanId);

    // 4. Verify traceparent was actually injected into the fetch request (echo server returns it)
    expect(result.downstream.headers.traceparent).toBeDefined();
    expect(result.downstream.headers.traceparent).toContain(upstreamTraceId);
    expect(result.downstream.headers.traceparent).toContain(fetchClientSpan.spanContext().spanId);

    // 5. Verify span names and kinds are correct

    expect(serverASpan.name).toBe("GET /upstream");
    expect(serverASpan.kind).toBe(SpanKind.SERVER);
    expect(fetchClientSpan.name).toMatch(/GET/); // OTel fetch uses "HTTP GET" or similar
    expect(fetchClientSpan.kind).toBe(SpanKind.CLIENT);
  });

  test("propagates trace context across setTimeout boundary", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "settimeout-test",
      // Note: Don't specify instrumentations to auto-register BunHttpInstrumentation + BunFetchInstrumentation
    });

    sdk.start();

    // Server that delays fetch with setTimeout
    using server = Bun.serve({
      port: 0,
      async fetch(req: Request) {
        // Use a promise to wait for setTimeout and get the echo response
        const echoData = await new Promise<any>(resolve => {
          setTimeout(async () => {
            // This fetch should still be in the request's context
            const response = await fetch(echoServer.getUrl("/delayed"));
            const data = await response.json();
            resolve(data);
          }, 10); // Small delay to test async boundary
        });
        return Response.json(echoData);
      },
    });

    const upstreamTraceId = "ccddee112233445566778899aabbccdd";
    const upstreamSpanId = "aabbccdd11223344";
    const traceparent = `00-${upstreamTraceId}-${upstreamSpanId}-01`;

    // Use remote control to avoid instrumenting the test request
    const response = await echoServer.remoteControl.fetch(`http://localhost:${server.port}/test`, {
      headers: { traceparent },
    });
    const echoData = await response.json();

    // Wait for 2 spans with our specific trace ID
    await waitForSpans(exporter, 2, 1000, { traceId: upstreamTraceId });

    // Filter to only get spans from this test (by trace ID)
    const allSpans = exporter.getFinishedSpans();
    const spans = allSpans.filter(s => s.spanContext().traceId === upstreamTraceId);
    expect(spans).toHaveLength(2);

    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER)!;
    const fetchClientSpan = spans.find(s => s.kind === SpanKind.CLIENT)!;

    // Both spans should share the same trace ID
    expect(serverSpan.spanContext().traceId).toBe(upstreamTraceId);
    expect(fetchClientSpan.spanContext().traceId).toBe(upstreamTraceId);

    // Server span should be child of incoming request
    expect(serverSpan.parentSpanContext?.spanId).toBe(upstreamSpanId);

    // CRITICAL: CLIENT span created inside setTimeout should still be child of server span
    // This proves AsyncLocalStorage context propagates across async boundaries
    expect(fetchClientSpan.parentSpanContext?.spanId).toBe(serverSpan.spanContext().spanId);

    // Verify traceparent was injected into the fetch request (via echo server response)
    expect(echoData.headers.traceparent).toBeDefined();
    expect(echoData.headers.traceparent).toContain(upstreamTraceId);
    expect(echoData.headers.traceparent).toContain(fetchClientSpan.spanContext().spanId);

    // Verify span kinds

    expect(serverSpan.kind).toBe(SpanKind.SERVER);
    expect(fetchClientSpan.kind).toBe(SpanKind.CLIENT);
  });

  test("propagates trace context across setImmediate boundary", async () => {
    // Tests that AsyncLocalStorage context persists through setImmediate callbacks.
    // setImmediate schedules work after I/O events, similar to setTimeout(0) but
    // guaranteed to execute after the current I/O polling phase.
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "setimmediate-test",
      // Note: Don't specify instrumentations to auto-register BunHttpInstrumentation + BunFetchInstrumentation
    });

    sdk.start();

    using server = Bun.serve({
      port: 0,
      async fetch(req: Request) {
        const echoData = await new Promise<any>(resolve => {
          setImmediate(async () => {
            const response = await fetch(echoServer.getUrl("/immediate"));
            const data = await response.json();
            resolve(data);
          });
        });
        return Response.json(echoData);
      },
    });

    const upstreamTraceId = "11223344556677889900aabbccddeeff";
    const upstreamSpanId = "1122334455667788";
    const traceparent = `00-${upstreamTraceId}-${upstreamSpanId}-01`;

    const response = await echoServer.remoteControl.fetch(`http://localhost:${server.port}/test`, {
      headers: { traceparent },
    });
    const echoData = await response.json();

    await waitForSpans(exporter, 2, 1000, { traceId: upstreamTraceId });
    const spans = exporter.getFinishedSpans().filter(s => s.spanContext().traceId === upstreamTraceId);
    expect(spans).toHaveLength(2);

    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER)!;
    const fetchClientSpan = spans.find(s => s.kind === SpanKind.CLIENT)!;

    expect(serverSpan.spanContext().traceId).toBe(upstreamTraceId);
    expect(serverSpan.parentSpanContext?.spanId).toBe(upstreamSpanId);
    expect(fetchClientSpan.spanContext().traceId).toBe(upstreamTraceId);
    expect(fetchClientSpan.parentSpanContext?.spanId).toBe(serverSpan.spanContext().spanId);
    expect(echoData.headers.traceparent).toBeDefined();
    expect(echoData.headers.traceparent).toContain(upstreamTraceId);
    expect(echoData.headers.traceparent).toContain(fetchClientSpan.spanContext().spanId);
  });

  test("propagates trace context through nested async functions", async () => {
    // Tests that context flows correctly through a chain of async function calls.
    // This verifies that each async function boundary maintains the parent context,
    // which is critical for real-world code that uses helper functions.
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "nested-async-test",
      // Note: Don't specify instrumentations to auto-register BunHttpInstrumentation + BunFetchInstrumentation
    });

    sdk.start();

    using server = Bun.serve({
      port: 0,
      async fetch(req: Request) {
        async function level1() {
          return await level2();
        }
        async function level2() {
          return await level3();
        }
        async function level3() {
          const response = await fetch(echoServer.getUrl("/nested"));
          return await response.json();
        }
        const echoData = await level1();
        return Response.json(echoData);
      },
    });

    const upstreamTraceId = "aabbccddeeff00112233445566778899";
    const upstreamSpanId = "aabbccdd11223344";
    const traceparent = `00-${upstreamTraceId}-${upstreamSpanId}-01`;

    const response = await echoServer.remoteControl.fetch(`http://localhost:${server.port}/test`, {
      headers: { traceparent },
    });
    const echoData = await response.json();

    await waitForSpans(exporter, 2, 1000, { traceId: upstreamTraceId });
    const spans = exporter.getFinishedSpans().filter(s => s.spanContext().traceId === upstreamTraceId);
    expect(spans).toHaveLength(2);

    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER)!;
    const fetchClientSpan = spans.find(s => s.kind === SpanKind.CLIENT)!;

    expect(serverSpan.spanContext().traceId).toBe(upstreamTraceId);
    expect(fetchClientSpan.spanContext().traceId).toBe(upstreamTraceId);
    expect(fetchClientSpan.parentSpanContext?.spanId).toBe(serverSpan.spanContext().spanId);
    expect(echoData.headers.traceparent).toBeDefined();
    expect(echoData.headers.traceparent).toContain(upstreamTraceId);
  });

  test("propagates trace context through async generator", async () => {
    // Tests that context is maintained across async generator yield points.
    // Each yield suspends execution and resumes later, so this verifies that
    // AsyncLocalStorage correctly restores context after each resume.
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "async-generator-test",
      // Note: Don't specify instrumentations to auto-register BunHttpInstrumentation + BunFetchInstrumentation
    });

    sdk.start();

    using server = Bun.serve({
      port: 0,
      async fetch(req: Request) {
        async function* fetchMultiple() {
          const r1 = await fetch(echoServer.getUrl("/gen1"));
          yield await r1.json();

          const r2 = await fetch(echoServer.getUrl("/gen2"));
          yield await r2.json();

          const r3 = await fetch(echoServer.getUrl("/gen3"));
          yield await r3.json();
        }

        const results = [];
        for await (const data of fetchMultiple()) {
          results.push(data);
        }
        return Response.json({ results });
      },
    });

    const upstreamTraceId = "ffeeddccbbaa99887766554433221100";
    const upstreamSpanId = "ffeeddccbbaa9988";
    const traceparent = `00-${upstreamTraceId}-${upstreamSpanId}-01`;

    const response = await echoServer.remoteControl.fetch(`http://localhost:${server.port}/test`, {
      headers: { traceparent },
    });
    const result = await response.json();

    // Wait for 1 SERVER + 3 CLIENT spans (scoped to our trace)
    await waitForSpans(exporter, 4, 1500, { traceId: upstreamTraceId });
    const spans = exporter.getFinishedSpans().filter(s => s.spanContext().traceId === upstreamTraceId);
    expect(spans).toHaveLength(4);

    // All spans should share same trace ID
    for (const span of spans) {
      expect(span.spanContext().traceId).toBe(upstreamTraceId);
    }

    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER);
    const clientSpans = spans.filter(s => s.kind === SpanKind.CLIENT);
    expect(clientSpans).toHaveLength(3);

    // All CLIENT spans created by generator should be children of SERVER span
    for (const clientSpan of clientSpans) {
      expect(clientSpan.parentSpanContext?.spanId).toBe(serverSpan!.spanContext().spanId);
    }
    // And each downstream response should include a traceparent with the same traceId
    for (const r of result.results) {
      expect(r.headers.traceparent).toBeDefined();
      expect(r.headers.traceparent).toContain(upstreamTraceId);
    }
  });

  test("fetch propagation works with parallel requests", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "parallel-fetch-test",
      // Note: Don't specify instrumentations to auto-register BunHttpInstrumentation + BunFetchInstrumentation
    });

    sdk.start();

    // Gateway that makes parallel fetch calls to external echo server
    using gateway = Bun.serve({
      port: 0,
      async fetch() {
        // Make 3 parallel fetch calls - all should get the same parent span context
        const [r1, r2, r3] = await Promise.all([
          fetch(echoServer.getUrl("/service1")),
          fetch(echoServer.getUrl("/service2")),
          fetch(echoServer.getUrl("/service3")),
        ]);

        return Response.json({
          results: [await r1.json(), await r2.json(), await r3.json()],
        });
      },
    });

    const traceId = "99aabbccddee0011223344556677ff88";
    const traceparent = `00-${traceId}-9988776655443322-01`;

    // Use remote control to avoid instrumenting the test request
    const response = await echoServer.remoteControl.fetch(`http://localhost:${gateway.port}/gateway`, {
      headers: { traceparent },
    });
    const result = await response.json();

    // Wait for 1 gateway (SERVER) + 3 fetch (CLIENT) = 4 spans
    // (Echo server is external, so no SERVER spans from it)
    await waitForSpans(exporter, 4, 1000, { traceId });

    const spans = exporter.getFinishedSpans().filter(s => s.spanContext().traceId === traceId);
    expect(spans).toHaveLength(4);

    // All spans share the same trace ID by construction (filtered)

    // Find the gateway span (parent of the 3 fetch CLIENT spans)
    const gatewaySpan = spans.find(s => s.name === "GET /gateway");
    expect(gatewaySpan).toBeDefined();

    // All 3 fetch CLIENT spans should be children of the gateway span
    const fetchClientSpans = spans.filter(s => s.kind === SpanKind.CLIENT);
    expect(fetchClientSpans).toHaveLength(3);

    for (const fetchSpan of fetchClientSpans) {
      expect(fetchSpan.parentSpanContext?.spanId).toBe(gatewaySpan!.spanContext().spanId);
    }

    // Verify traceparent was injected in all 3 parallel requests
    const headers = result.results.map((r: any) => String(r.headers.traceparent));
    for (const fetchSpan of fetchClientSpans) {
      expect(headers.some((h: string) => h?.includes(fetchSpan.spanContext().spanId))).toBe(true);
    }
  });
});
