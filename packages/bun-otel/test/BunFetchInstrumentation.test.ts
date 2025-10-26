/**
 * Tests for BunFetchInstrumentation
 *
 * Validates:
 * - CLIENT span creation for fetch() requests
 * - W3C TraceContext propagation (traceparent header injection)
 * - Attribute mapping to OTel semantic conventions
 * - Header capture configuration
 * - Error handling
 * - Span lifecycle (start, end, error)
 */

import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BunFetchInstrumentation } from "../src/instruments/BunFetchInstrumentation";
import { afterUsingEchoServer, beforeUsingEchoServer, getEchoServer, waitForSpans } from "./test-utils";

describe("BunFetchInstrumentation", () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeAll(beforeUsingEchoServer);
  afterAll(afterUsingEchoServer);

  beforeAll(() => {
    // Setup tracer provider with in-memory exporter
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  });

  test("implements Instrumentation interface", () => {
    using instrumentation = new BunFetchInstrumentation();
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    expect(instrumentation.instrumentationName).toBe("@opentelemetry/instrumentation-bun-fetch");
    expect(instrumentation.instrumentationVersion).toBe("0.1.0");
    expect(typeof instrumentation.enable).toBe("function");
    expect(typeof instrumentation.disable).toBe("function");
    expect(typeof instrumentation.setTracerProvider).toBe("function");
    expect(typeof instrumentation.setConfig).toBe("function");
    expect(typeof instrumentation.getConfig).toBe("function");
  });

  test("getConfig returns current configuration", () => {
    using instrumentation = new BunFetchInstrumentation({
      captureAttributes: {
        requestHeaders: ["content-type", "x-custom-header"],
        responseHeaders: ["content-type", "x-response-header"],
      },
    });
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    const config = instrumentation.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.captureAttributes?.requestHeaders).toEqual(["content-type", "x-custom-header"]);
    expect(config.captureAttributes?.responseHeaders).toEqual(["content-type", "x-response-header"]);
  });

  test("creates CLIENT span for successful fetch request", async () => {
    using instrumentation = new BunFetchInstrumentation();
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    await using echoServer = await getEchoServer();

    exporter.reset();

    // Make a fetch request
    const response = await fetch(echoServer.echoUrlStr("/test"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-custom-header": "test-value",
      },
      body: JSON.stringify({ test: "data" }),
    });

    expect(response.ok).toBe(true);

    // Wait for the CLIENT span to be exported (polling avoids flaky fixed sleeps)
    const [fetchSpan] = await waitForSpans(exporter, 1, 1000, s => s.client());
    expect(fetchSpan).toBeDefined();

    // Verify span attributes follow OTel semantic conventions
    expect(fetchSpan?.attributes["http.request.method"]).toBe("POST");
    expect(fetchSpan?.attributes["url.full"]).toBe(echoServer.echoUrlStr("/test"));
    expect(fetchSpan?.attributes["server.address"]).toBe("127.0.0.1");
    expect(fetchSpan?.attributes["server.port"]).toBe(echoServer.port);
    expect(fetchSpan?.attributes["url.scheme"]).toBe("http");

    // Verify response attributes
    expect(fetchSpan?.attributes["http.response.status_code"]).toBe(200);

    // Verify span status
    expect(fetchSpan?.status.code).toBe(SpanStatusCode.OK);
  });

  test("captures configured request headers as span attributes", async () => {
    using instrumentation = new BunFetchInstrumentation({
      captureAttributes: {
        requestHeaders: ["content-type", "x-custom-header"],
      },
    });
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    await using echoServer = await getEchoServer();
    exporter.reset();

    await fetch(echoServer.echoUrlStr("/headers"), {
      headers: {
        "content-type": "application/json",
        "x-custom-header": "my-value",
        "x-uncaptured-header": "should-not-appear",
      },
    });

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    const fetchSpan = spans.find(s => s.kind === SpanKind.CLIENT);
    expect(fetchSpan).toBeDefined();

    expect(fetchSpan?.attributes["http.request.header.content-type"]).toBe("application/json");
    expect(fetchSpan?.attributes["http.request.header.x-custom-header"]).toBe("my-value");
    expect(fetchSpan?.attributes["http.request.header.x-uncaptured-header"]).toBeUndefined();
  });

  test("injects traceparent header for distributed tracing", async () => {
    using instrumentation = new BunFetchInstrumentation();
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    await using echoServer = await getEchoServer();

    exporter.reset();

    const response = await fetch(echoServer.echoUrlStr("/trace"));
    const body = await response.json();

    // Verify traceparent header was injected
    expect(body.headers.traceparent).toBeDefined();
    expect(body.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);

    // Extract trace & span IDs from traceparent header
    const traceparentMatch = body.headers.traceparent.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/);
    expect(traceparentMatch).toBeDefined();
    const [, traceId, spanId] = traceparentMatch!;

    // Wait specifically for the span with matching IDs
    const [fetchSpan] = await waitForSpans(exporter, 1, 1000, s => s.client().withTraceId(traceId).withSpanId(spanId));
    expect(fetchSpan.spanContext().traceId).toBe(traceId);
    expect(fetchSpan.spanContext().spanId).toBe(spanId);
  });

  test("sets span status to ERROR for HTTP error responses", async () => {
    using instrumentation = new BunFetchInstrumentation();
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    await using echoServer = await getEchoServer();

    exporter.reset();

    // We'll need to use a real server that returns errors
    // For now, let's test with a non-existent endpoint
    try {
      await fetch("http://localhost:1/nonexistent");
    } catch {
      // Connection will fail, which is expected
    }

    const [errorSpan] = await waitForSpans(exporter, 1, 1000, s => s.client().withStatusCode(SpanStatusCode.ERROR));
    expect(errorSpan).toBeDefined();
    expect(errorSpan.status.code).toBe(SpanStatusCode.ERROR);
  });

  test("span name is HTTP method only (OTel v1.23.0 spec)", async () => {
    using instrumentation = new BunFetchInstrumentation();
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    await using echoServer = await getEchoServer();

    exporter.reset();

    await fetch(echoServer.echoUrlStr("/api/users"), {
      method: "GET",
    });

    const [fetchSpan] = await waitForSpans(exporter, 1, 1000, s => s.client());

    // Per OTel v1.23.0: HTTP client span names should be just the method (low cardinality)
    // URL is captured in attributes instead to prevent cardinality explosions
    expect(fetchSpan?.name).toBe("GET");
    expect(fetchSpan?.attributes["url.full"]).toContain("/api/users");
  });

  test("disable() detaches instrumentation", () => {
    const newInst = new BunFetchInstrumentation();
    newInst.setTracerProvider(provider);
    newInst.enable();

    // Should have an instrument ID after enable
    expect((newInst as any)._instrumentId).toBeDefined();

    newInst.disable();

    // Should clear instrument ID after disable
    expect((newInst as any)._instrumentId).toBeUndefined();
  });

  test("setConfig updates configuration", () => {
    const newInst = new BunFetchInstrumentation({
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
      new BunFetchInstrumentation({
        captureAttributes: {
          requestHeaders: ["authorization"],
        },
      });
    }).toThrow(/authorization/i);

    expect(() => {
      new BunFetchInstrumentation({
        captureAttributes: {
          requestHeaders: ["cookie"],
        },
      });
    }).toThrow(/cookie/i);
  });

  test("handles multiple concurrent fetch requests", async () => {
    using instrumentation = new BunFetchInstrumentation();
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    await using echoServer = await getEchoServer();

    exporter.reset();

    // Make 5 concurrent fetch requests
    const promises = Array.from({ length: 5 }, (_, i) =>
      fetch(echoServer.echoUrlStr(`/concurrent-${i}`), {
        headers: { "x-request-id": `req-${i}` },
      }),
    );

    const responses = await Promise.all(promises);
    expect(responses.every(r => r.ok)).toBe(true);

    const fetchSpans = await waitForSpans(exporter, 5, 1000, s => s.client());
    expect(fetchSpans.length).toBe(5); // Should have 5 CLIENT spans
    const paths = fetchSpans.map(s => s.attributes["url.full"]); // Each should have unique request
    expect(new Set(paths).size).toBe(5);
  });
});
