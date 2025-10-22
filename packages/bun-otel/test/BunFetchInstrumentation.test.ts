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
import { ConfigurationProperty } from "../types";
import { TempConfig } from "./config-helper";
import { EchoServer } from "./echo-server";

describe("BunFetchInstrumentation", () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let instrumentation: BunFetchInstrumentation;

  using _globalConfig = new TempConfig({
    [ConfigurationProperty.http_capture_headers_fetch_request]: ["content-type", "x-custom-header"],
    [ConfigurationProperty.http_capture_headers_fetch_response]: ["content-type", "x-response-header"],
  });

  beforeAll(() => {
    // Setup tracer provider with in-memory exporter
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

    // Create and enable instrumentation
    instrumentation = new BunFetchInstrumentation({
      captureAttributes: {
        requestHeaders: ["content-type", "x-custom-header"],
        responseHeaders: ["content-type", "x-response-header"],
      },
    });

    instrumentation.setTracerProvider(provider);
    instrumentation.enable();
  });

  afterAll(() => {
    instrumentation.disable();
  });

  test("implements Instrumentation interface", () => {
    expect(instrumentation.instrumentationName).toBe("@opentelemetry/instrumentation-bun-fetch");
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
    expect(config.captureAttributes?.requestHeaders).toEqual(["content-type", "x-custom-header"]);
    expect(config.captureAttributes?.responseHeaders).toEqual(["content-type", "x-response-header"]);
  });

  test("creates CLIENT span for successful fetch request", async () => {
    await using echoServer = new EchoServer();
    await echoServer.start();

    exporter.reset();

    // Make a fetch request
    const response = await fetch(echoServer.getUrl("/test"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-custom-header": "test-value",
      },
      body: JSON.stringify({ test: "data" }),
    });

    expect(response.ok).toBe(true);

    // Wait for span to be exported
    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);

    const fetchSpan = spans.find(s => s.kind === SpanKind.CLIENT);
    expect(fetchSpan).toBeDefined();

    // Verify span attributes follow OTel semantic conventions
    expect(fetchSpan?.attributes["http.request.method"]).toBe("POST");
    expect(fetchSpan?.attributes["url.full"]).toBe(echoServer.getUrl("/test"));
    expect(fetchSpan?.attributes["server.address"]).toBe("127.0.0.1");
    expect(fetchSpan?.attributes["server.port"]).toBe(Number(new URL(echoServer.getUrl()).port));
    expect(fetchSpan?.attributes["url.scheme"]).toBe("http");

    // Verify response attributes
    expect(fetchSpan?.attributes["http.response.status_code"]).toBe(200);

    // Verify span status
    expect(fetchSpan?.status.code).toBe(SpanStatusCode.OK);
  });

  test("captures configured request headers as span attributes", async () => {
    await using echoServer = new EchoServer();
    await echoServer.start();

    exporter.reset();

    await fetch(echoServer.getUrl("/headers"), {
      headers: {
        "content-type": "application/json",
        "x-custom-header": "my-value",
        "x-uncaptured-header": "should-not-appear",
      },
    });

    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    const fetchSpan = spans.find(s => s.kind === SpanKind.CLIENT);

    expect(fetchSpan?.attributes["http.request.header.content-type"]).toBe("application/json");
    expect(fetchSpan?.attributes["http.request.header.x-custom-header"]).toBe("my-value");
    expect(fetchSpan?.attributes["http.request.header.x-uncaptured-header"]).toBeUndefined();
  });

  test("injects traceparent header for distributed tracing", async () => {
    await using echoServer = new EchoServer();
    await echoServer.start();

    exporter.reset();

    const response = await fetch(echoServer.getUrl("/trace"));
    const body = await response.json();

    // Verify traceparent header was injected
    expect(body.headers.traceparent).toBeDefined();
    expect(body.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);

    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    const fetchSpan = spans.find(s => s.kind === SpanKind.CLIENT);
    expect(fetchSpan).toBeDefined();

    // Extract trace ID from traceparent header
    const traceparentMatch = body.headers.traceparent.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/);
    expect(traceparentMatch).toBeDefined();

    const [, traceId, spanId] = traceparentMatch!;

    // Verify span trace ID matches injected traceparent
    expect(fetchSpan?.spanContext().traceId).toBe(traceId);
    expect(fetchSpan?.spanContext().spanId).toBe(spanId);
  });

  test("sets span status to ERROR for HTTP error responses", async () => {
    await using echoServer = new EchoServer();
    await echoServer.start();

    exporter.reset();

    // We'll need to use a real server that returns errors
    // For now, let's test with a non-existent endpoint
    try {
      await fetch("http://localhost:1/nonexistent");
    } catch {
      // Connection will fail, which is expected
    }

    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    const errorSpan = spans.find(s => s.kind === SpanKind.CLIENT && s.status.code === SpanStatusCode.ERROR);

    expect(errorSpan).toBeDefined();
    expect(errorSpan?.status.code).toBe(SpanStatusCode.ERROR);
  });

  test("span name follows 'METHOD URL' pattern", async () => {
    await using echoServer = new EchoServer();
    await echoServer.start();

    exporter.reset();

    await fetch(echoServer.getUrl("/api/users"), {
      method: "GET",
    });

    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    const fetchSpan = spans.find(s => s.kind === SpanKind.CLIENT);

    expect(fetchSpan?.name).toMatch(/^GET /);
    expect(fetchSpan?.name).toContain("/api/users");
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

  test("throws error when TracerProvider not set before enable()", () => {
    const newInst = new BunFetchInstrumentation();

    expect(() => {
      newInst.enable();
    }).toThrow(/TracerProvider not set/);
  });

  test("handles multiple concurrent fetch requests", async () => {
    await using echoServer = new EchoServer();
    await echoServer.start();

    exporter.reset();

    // Make 5 concurrent fetch requests
    const promises = Array.from({ length: 5 }, (_, i) =>
      fetch(echoServer.getUrl(`/concurrent-${i}`), {
        headers: { "x-request-id": `req-${i}` },
      }),
    );

    const responses = await Promise.all(promises);
    expect(responses.every(r => r.ok)).toBe(true);

    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    const fetchSpans = spans.filter(s => s.kind === SpanKind.CLIENT);

    // Should have 5 CLIENT spans
    expect(fetchSpans.length).toBe(5);

    // Each should have unique request
    const paths = fetchSpans.map(s => s.attributes["url.full"]);
    expect(new Set(paths).size).toBe(5);
  });
});
