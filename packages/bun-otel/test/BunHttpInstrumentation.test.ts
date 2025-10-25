/**
 * Tests for BunHttpInstrumentation
 *
 * Validates:
 * - SERVER span creation for Bun.serve() requests
 * - W3C TraceContext extraction (traceparent header parsing)
 * - Parent span context propagation
 * - Attribute mapping to OTel semantic conventions
 * - Header capture configuration
 * - Error handling
 * - Span lifecycle (start, end, error)
 * - HTTP status code handling (4xx vs 5xx)
 */

import { propagation, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BunHttpInstrumentation } from "../src/instruments/BunHttpInstrumentation";
import { waitForSpans } from "./test-utils";

describe("BunHttpInstrumentation", () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let instrumentation: BunHttpInstrumentation;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let serverUrl: string;

  beforeAll(async () => {
    // Setup W3C trace context propagator (required for traceparent header extraction)
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    // Setup tracer provider with in-memory exporter
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

    // Create and enable instrumentation BEFORE starting server
    instrumentation = new BunHttpInstrumentation({
      captureAttributes: {
        requestHeaders: ["user-agent", "x-request-id"],
        responseHeaders: ["content-type", "x-trace-id"],
      },
    });

    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    // Start test server
    server = Bun.serve({
      port: 0,
      fetch(req: Request) {
        const url = new URL(req.url);

        if (url.pathname === "/hello") {
          return new Response("Hello, World!", {
            headers: {
              "content-type": "text/plain",
              "x-trace-id": "test-trace-123",
            },
          });
        }

        if (url.pathname === "/json") {
          return Response.json({ message: "success" });
        }

        if (url.pathname === "/error") {
          return new Response("Internal Server Error", { status: 500 });
        }

        if (url.pathname === "/not-found") {
          return new Response("Not Found", { status: 404 });
        }

        if (url.pathname === "/throw") {
          throw new Error("Simulated error");
        }

        return new Response("OK");
      },
    });

    serverUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    instrumentation.disable();
    server?.stop();
    server = null;
  });

  test("implements Instrumentation interface", () => {
    expect(instrumentation.instrumentationName).toBe("@opentelemetry/instrumentation-bun-http");
    expect(instrumentation.instrumentationVersion).toBe("0.1.0");
    expect(typeof instrumentation.enable).toBe("function");
    expect(typeof instrumentation.disable).toBe("function");
    expect(typeof instrumentation.setTracerProvider).toBe("function");
    expect(typeof instrumentation.setConfig).toBe("function");
    expect(typeof instrumentation.getConfig).toBe("function");
  });

  test("getConfig returns current configuration", () => {
    const config = instrumentation.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.captureAttributes?.requestHeaders).toEqual(["user-agent", "x-request-id"]);
    expect(config.captureAttributes?.responseHeaders).toEqual(["content-type", "x-trace-id"]);
  });

  test("creates SERVER span for incoming HTTP request", async () => {
    exporter.reset();

    const response = await fetch(`${serverUrl}/hello`, {
      headers: {
        "user-agent": "test-client/1.0",
        "x-request-id": "req-123",
      },
    });

    expect(response.ok).toBe(true);
    expect(await response.text()).toBe("Hello, World!");

    // Wait for span to be exported
    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);

    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER);
    expect(serverSpan).toBeDefined();

    // Verify span attributes follow OTel semantic conventions
    expect(serverSpan?.attributes["http.request.method"]).toBe("GET");
    expect(serverSpan?.attributes["url.path"]).toBe("/hello");
    expect(serverSpan?.attributes["url.scheme"]).toBe("http");
    expect(serverSpan?.attributes["server.address"]).toBe("127.0.0.1");
    expect(serverSpan?.attributes["server.port"]).toBe(server!.port);

    // Verify response attributes
    expect(serverSpan?.attributes["http.response.status_code"]).toBe(200);

    // Verify span status
    expect(serverSpan?.status.code).toBe(SpanStatusCode.OK);
  });

  test("captures configured request headers as span attributes", async () => {
    exporter.reset();

    await fetch(`${serverUrl}/hello`, {
      headers: {
        "user-agent": "custom-agent",
        "x-request-id": "req-456",
        "x-uncaptured-header": "should-not-appear",
      },
    });

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER);

    expect(serverSpan?.attributes["http.request.header.user-agent"]).toBe("custom-agent");
    expect(serverSpan?.attributes["http.request.header.x-request-id"]).toBe("req-456");
    expect(serverSpan?.attributes["http.request.header.x-uncaptured-header"]).toBeUndefined();
  });

  test("captures configured response headers as span attributes", async () => {
    exporter.reset();

    await fetch(`${serverUrl}/hello`);

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER);

    expect(serverSpan?.attributes["http.response.header.content-type"]).toBe("text/plain");
    expect(serverSpan?.attributes["http.response.header.x-trace-id"]).toBe("test-trace-123");
  });

  test("extracts parent span context from traceparent header", async () => {
    exporter.reset();

    // Send request with traceparent header
    const parentTraceId = "0af7651916cd43dd8448eb211c80319c";
    const parentSpanId = "b7ad6b7169203331";
    const traceparent = `00-${parentTraceId}-${parentSpanId}-01`;

    await fetch(`${serverUrl}/hello`, {
      headers: {
        traceparent,
      },
    });

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER);
    expect(serverSpan).toBeDefined();

    // Verify span has correct parent context
    expect(serverSpan?.spanContext().traceId).toBe(parentTraceId);
    // Parent span ID should be referenced (not the same as current span)
    expect(serverSpan?.parentSpanContext?.spanId).toBe(parentSpanId);
  });

  test("span name follows 'METHOD path' pattern", async () => {
    exporter.reset();

    await fetch(`${serverUrl}/api/users`, {
      method: "POST",
    });

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER);

    expect(serverSpan?.name).toMatch(/^POST /);
    expect(serverSpan?.name).toContain("/api/users");
  });

  test("4xx client errors do not set span status to ERROR", async () => {
    exporter.reset();

    const response = await fetch(`${serverUrl}/not-found`);
    expect(response.status).toBe(404);

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER);

    // Per OTel spec, 4xx errors should NOT set span status to ERROR
    expect(serverSpan?.status.code).toBe(SpanStatusCode.OK);
    expect(serverSpan?.attributes["http.response.status_code"]).toBe(404);
  });

  test("5xx server errors set span status to ERROR", async () => {
    exporter.reset();

    const response = await fetch(`${serverUrl}/error`);
    expect(response.status).toBe(500);

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER);

    // 5xx errors SHOULD set span status to ERROR
    expect(serverSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(serverSpan?.attributes["http.response.status_code"]).toBe(500);
  });

  test("handles multiple concurrent requests", async () => {
    exporter.reset();

    // Make 10 concurrent requests
    const promises = Array.from({ length: 10 }, (_, i) =>
      fetch(`${serverUrl}/hello`, {
        headers: { "x-request-id": `concurrent-${i}` },
      }),
    );

    const responses = await Promise.all(promises);
    expect(responses.every(r => r.ok)).toBe(true);

    await waitForSpans(exporter, 10);

    const spans = exporter.getFinishedSpans();
    const serverSpans = spans.filter(s => s.kind === SpanKind.SERVER);

    // Should have 10 SERVER spans
    expect(serverSpans.length).toBe(10);

    // Each should have unique span ID
    const spanIds = serverSpans.map(s => s.spanContext().spanId);
    expect(new Set(spanIds).size).toBe(10);
  });

  test("disable() detaches instrumentation", () => {
    const newInst = new BunHttpInstrumentation();
    newInst.setTracerProvider(provider);
    newInst.enable();

    // Should have an instrument ID after enable
    expect((newInst as any)._instrumentId).toBeDefined();

    newInst.disable();

    // Should clear instrument ID after disable
    expect((newInst as any)._instrumentId).toBeUndefined();
  });

  test("setConfig updates configuration", () => {
    const newInst = new BunHttpInstrumentation({
      enabled: true,
      captureAttributes: {
        requestHeaders: ["accept"],
      },
    });

    expect(newInst.getConfig().captureAttributes?.requestHeaders).toEqual(["accept"]);

    newInst.setConfig({
      captureAttributes: {
        requestHeaders: ["content-type"],
        responseHeaders: ["cache-control"],
      },
    });

    const config = newInst.getConfig();
    expect(config.captureAttributes?.requestHeaders).toEqual(["content-type"]);
    expect(config.captureAttributes?.responseHeaders).toEqual(["cache-control"]);
  });

  test("validates blocked headers at construction time", () => {
    expect(() => {
      new BunHttpInstrumentation({
        captureAttributes: {
          requestHeaders: ["authorization"],
        },
      });
    }).toThrow(/authorization/i);

    expect(() => {
      new BunHttpInstrumentation({
        captureAttributes: {
          responseHeaders: ["set-cookie"],
        },
      });
    }).toThrow(/set-cookie/i);
  });

  // Note: Removed test "throws error when TracerProvider not set before enable()"
  // The implementation correctly falls back to trace.getTracer() per OpenTelemetry spec
  // Instrumentations should gracefully degrade without requiring explicit TracerProvider

  test("captures query parameters in url.query attribute", async () => {
    exporter.reset();

    await fetch(`${serverUrl}/hello?foo=bar&baz=qux`);

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER);

    expect(serverSpan?.attributes["url.query"]).toBe("foo=bar&baz=qux");
    expect(serverSpan?.attributes["url.path"]).toBe("/hello");
  });

  test("handles POST requests with body", async () => {
    exporter.reset();

    const response = await fetch(`${serverUrl}/json`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ test: "data" }),
    });

    expect(response.ok).toBe(true);

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    const serverSpan = spans.find(s => s.kind === SpanKind.SERVER);

    expect(serverSpan?.attributes["http.request.method"]).toBe("POST");
    expect(serverSpan?.attributes["url.path"]).toBe("/json");
  });
});
