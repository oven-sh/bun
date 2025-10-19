import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "bun:test";
import { BunSDK } from "./index";
import { waitForSpans } from "./test-utils";

describe("Distributed tracing with fetch propagation", () => {
  test("propagates trace context from server A → fetch → server B", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "distributed-tracing-test",
      instrumentations: [new FetchInstrumentation()],
    });

    sdk.start();

    // Server B - downstream service that receives propagated context
    using serverB = Bun.serve({
      port: 0,
      fetch(req) {
        // Server B should see the traceparent header from server A's fetch call
        const traceparent = req.headers.get("traceparent");
        return Response.json({ traceparent });
      },
    });

    // Server A - upstream service that makes fetch call to server B
    using serverA = Bun.serve({
      port: 0,
      async fetch(req) {
        // This fetch call should automatically inject traceparent from active span
        const response = await fetch(`http://localhost:${serverB.port}/downstream`);
        const data = await response.json();
        return Response.json({ downstream: data });
      },
    });

    try {
      // Make request to server A with a known trace context
      const upstreamTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
      const upstreamSpanId = "00f067aa0ba902b7";
      const traceparent = `00-${upstreamTraceId}-${upstreamSpanId}-01`;

      const response = await fetch(`http://localhost:${serverA.port}/upstream`, {
        headers: { traceparent },
      });

      const result = await response.json();

      // Wait for 3 spans: serverA (SERVER) + fetch to serverB (CLIENT) + serverB (SERVER)
      await waitForSpans(exporter, 3);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(3);

      // Sort spans by start time to ensure consistent ordering
      spans.sort((a, b) => {
        const aTime = a.startTime[0] * 1_000_000_000 + a.startTime[1];
        const bTime = b.startTime[0] * 1_000_000_000 + b.startTime[1];
        return aTime - bTime;
      });

      // With fetch instrumentation: serverA (SERVER), fetchClient (CLIENT), serverB (SERVER)
      const [serverASpan, fetchClientSpan, serverBSpan] = spans;

      // CRITICAL ASSERTIONS for distributed tracing:

      // 1. All spans should share the same trace ID (distributed trace)
      expect(serverASpan.spanContext().traceId).toBe(upstreamTraceId);
      expect(fetchClientSpan.spanContext().traceId).toBe(upstreamTraceId);
      expect(serverBSpan.spanContext().traceId).toBe(upstreamTraceId);

      // 2. Server A's span should be a child of the incoming request
      expect(serverASpan.parentSpanId).toBe(upstreamSpanId);

      // 3. Fetch CLIENT span should be a child of server A's span
      expect(fetchClientSpan.parentSpanId).toBe(serverASpan.spanContext().spanId);

      // 4. Server B's span should be a child of the fetch CLIENT span
      expect(serverBSpan.parentSpanId).toBe(fetchClientSpan.spanContext().spanId);

      // 5. Verify traceparent was actually injected into the fetch request
      expect(result.downstream.traceparent).toBeDefined();
      expect(result.downstream.traceparent).toContain(upstreamTraceId);
      expect(result.downstream.traceparent).toContain(fetchClientSpan.spanContext().spanId);

      // 6. Verify span names and kinds are correct
      expect(serverASpan.name).toBe("GET /upstream");
      expect(serverASpan.kind).toBe(1); // SpanKind.SERVER
      expect(fetchClientSpan.name).toMatch(/GET/); // OTel fetch uses "HTTP GET" or similar
      expect(fetchClientSpan.kind).toBe(3); // SpanKind.CLIENT
      expect(serverBSpan.name).toBe("GET /downstream");
      expect(serverBSpan.kind).toBe(1); // SpanKind.SERVER
    } finally {
      await sdk.shutdown();
    }
  });

  test("handles nested fetch calls (A → B → C)", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    // Server C - deepest level
    using serverC = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK from C");
      },
    });

    // Server B - middle layer, calls C
    using serverB = Bun.serve({
      port: 0,
      async fetch() {
        await fetch(`http://localhost:${serverC.port}/c`);
        return new Response("OK from B");
      },
    });

    // Server A - top layer, calls B
    using serverA = Bun.serve({
      port: 0,
      async fetch() {
        await fetch(`http://localhost:${serverB.port}/b`);
        return new Response("OK from A");
      },
    });

    try {
      const rootTraceId = "aabbccddeeff00112233445566778899";
      const rootSpanId = "1122334455667788";

      await fetch(`http://localhost:${serverA.port}/a`, {
        headers: {
          traceparent: `00-${rootTraceId}-${rootSpanId}-01`,
        },
      });

      // Wait for all 3 spans
      await waitForSpans(exporter, 3);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(3);

      // All spans should share the same trace ID
      for (const span of spans) {
        expect(span.spanContext().traceId).toBe(rootTraceId);
      }

      // Sort by depth (using parent relationships)
      const spanMap = new Map(spans.map(s => [s.spanContext().spanId, s]));
      const spanA = spans.find(s => s.parentSpanId === rootSpanId);
      expect(spanA).toBeDefined();

      const spanB = spans.find(s => s.parentSpanId === spanA!.spanContext().spanId);
      expect(spanB).toBeDefined();

      const spanC = spans.find(s => s.parentSpanId === spanB!.spanContext().spanId);
      expect(spanC).toBeDefined();

      // Verify the hierarchy: root → A → B → C
      expect(spanA!.name).toBe("GET /a");
      expect(spanB!.name).toBe("GET /b");
      expect(spanC!.name).toBe("GET /c");
    } finally {
      await sdk.shutdown();
    }
  });

  test("fetch propagation works with parallel requests", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    // Backend service
    using backend = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        return new Response(path);
      },
    });

    // Gateway that makes parallel fetch calls
    using gateway = Bun.serve({
      port: 0,
      async fetch() {
        // Make 3 parallel fetch calls - all should get the same parent span context
        const [r1, r2, r3] = await Promise.all([
          fetch(`http://localhost:${backend.port}/service1`),
          fetch(`http://localhost:${backend.port}/service2`),
          fetch(`http://localhost:${backend.port}/service3`),
        ]);

        return Response.json({
          results: [await r1.text(), await r2.text(), await r3.text()],
        });
      },
    });

    try {
      const traceId = "99aabbccddee0011223344556677ff88";

      await fetch(`http://localhost:${gateway.port}/gateway`, {
        headers: {
          traceparent: `00-${traceId}-9988776655443322-01`,
        },
      });

      // Wait for 1 gateway span + 3 backend spans
      await waitForSpans(exporter, 4);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(4);

      // All spans share the same trace ID
      for (const span of spans) {
        expect(span.spanContext().traceId).toBe(traceId);
      }

      // Find the gateway span (parent of the 3 backend calls)
      const gatewaySpan = spans.find(s => s.name === "GET /gateway");
      expect(gatewaySpan).toBeDefined();

      // All 3 backend spans should be children of the gateway span
      const backendSpans = spans.filter(s => s.name.includes("/service"));
      expect(backendSpans).toHaveLength(3);

      for (const backendSpan of backendSpans) {
        expect(backendSpan.parentSpanId).toBe(gatewaySpan!.spanContext().spanId);
      }
    } finally {
      await sdk.shutdown();
    }
  });
});
