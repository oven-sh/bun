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

import { propagation, SpanStatusCode } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BunHttpInstrumentation } from "../src/instruments/BunHttpInstrumentation";
import { TestSDK } from "./test-utils";

describe("BunHttpInstrumentation", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let serverUrl: string;

  beforeAll(async () => {
    // Setup W3C trace context propagator (required for traceparent header extraction)
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

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
    server?.stop();
    server = null;
  });

  test("implements Instrumentation interface", () => {
    const inst = new BunHttpInstrumentation();
    expect(inst.instrumentationName).toBe("@opentelemetry/instrumentation-bun-http");
    expect(inst.instrumentationVersion).toBe("0.1.0");
    expect(typeof inst.enable).toBe("function");
    expect(typeof inst.disable).toBe("function");
    expect(typeof inst.setTracerProvider).toBe("function");
    expect(typeof inst.setConfig).toBe("function");
    expect(typeof inst.getConfig).toBe("function");
  });

  test("getConfig returns current configuration", () => {
    const inst = new BunHttpInstrumentation({
      captureAttributes: {
        requestHeaders: ["user-agent", "x-request-id"],
        responseHeaders: ["content-type", "x-trace-id"],
      },
    });
    const config = inst.getConfig();
    expect(config.captureAttributes?.requestHeaders).toEqual(["user-agent", "x-request-id"]);
    expect(config.captureAttributes?.responseHeaders).toEqual(["content-type", "x-trace-id"]);
  });

  test("creates SERVER span for incoming HTTP request", async () => {
    await using tsdk = new TestSDK({
      instrumentations: [
        new BunHttpInstrumentation({
          captureAttributes: {
            requestHeaders: ["user-agent", "x-request-id"],
            responseHeaders: ["content-type", "x-trace-id"],
          },
        }),
      ],
    });

    const response = await fetch(`${serverUrl}/hello`, {
      headers: {
        "user-agent": "test-client/1.0",
        "x-request-id": "req-123",
      },
    });

    expect(response.ok).toBe(true);
    expect(await response.text()).toBe("Hello, World!");

    const [serverSpan] = await tsdk.waitForSpans(1, 1000, s => s.server());

    // Verify span attributes follow OTel semantic conventions
    expect(serverSpan.attributes["http.request.method"]).toBe("GET");
    expect(serverSpan.attributes["url.path"]).toBe("/hello");
    expect(serverSpan.attributes["url.scheme"]).toBe("http");
    expect(serverSpan.attributes["server.address"]).toBe("127.0.0.1");
    expect(serverSpan.attributes["server.port"]).toBe(server!.port);

    // Verify response attributes
    expect(serverSpan.attributes["http.response.status_code"]).toBe(200);

    // Verify span status
    expect(serverSpan.status.code).toBe(SpanStatusCode.OK);
  });

  test("captures configured request headers as span attributes", async () => {
    await using tsdk = new TestSDK({
      instrumentations: [
        new BunHttpInstrumentation({
          captureAttributes: {
            requestHeaders: ["user-agent", "x-request-id"],
          },
        }),
      ],
    });

    await fetch(`${serverUrl}/hello`, {
      headers: {
        "user-agent": "custom-agent",
        "x-request-id": "req-456",
        "x-uncaptured-header": "should-not-appear",
      },
    });

    const [serverSpan] = await tsdk.waitForSpans(1, 1000, s => s.server());

    expect(serverSpan.attributes["http.request.header.user-agent"]).toBe("custom-agent");
    expect(serverSpan.attributes["http.request.header.x-request-id"]).toBe("req-456");
    expect(serverSpan.attributes["http.request.header.x-uncaptured-header"]).toBeUndefined();
  });

  test("captures configured response headers as span attributes", async () => {
    await using tsdk = new TestSDK({
      instrumentations: [
        new BunHttpInstrumentation({
          captureAttributes: {
            responseHeaders: ["content-type", "x-trace-id"],
          },
        }),
      ],
    });

    await fetch(`${serverUrl}/hello`);

    const [serverSpan] = await tsdk.waitForSpans(1, 1000, s => s.server());

    expect(serverSpan.attributes["http.response.header.content-type"]).toBe("text/plain");
    expect(serverSpan.attributes["http.response.header.x-trace-id"]).toBe("test-trace-123");
  });

  test("extracts parent span context from traceparent header", async () => {
    await using tsdk = new TestSDK({
      instrumentations: [new BunHttpInstrumentation()],
    });

    // Send request with traceparent header
    const parentTraceId = "0af7651916cd43dd8448eb211c80319c";
    const parentSpanId = "b7ad6b7169203331";
    const traceparent = `00-${parentTraceId}-${parentSpanId}-01`;

    await fetch(`${serverUrl}/hello`, {
      headers: {
        traceparent,
      },
    });

    const [serverSpan] = await tsdk.waitForSpans(1, 1000, s => s.server().withTraceId(parentTraceId));

    // Verify span has correct parent context
    expect(serverSpan.spanContext().traceId).toBe(parentTraceId);
    // Parent span ID should be referenced (not the same as current span)
    expect(serverSpan.parentSpanContext?.spanId).toBe(parentSpanId);
  });

  test("span name follows 'METHOD path' pattern", async () => {
    await using tsdk = new TestSDK({
      instrumentations: [new BunHttpInstrumentation()],
    });

    await fetch(`${serverUrl}/api/users`, {
      method: "POST",
    });

    const [serverSpan] = await tsdk.waitForSpans(1, 1000, s => s.server());

    expect(serverSpan.name).toMatch(/^POST /);
    expect(serverSpan.name).toContain("/api/users");
  });

  test("4xx client errors do not set span status to ERROR", async () => {
    await using tsdk = new TestSDK({
      instrumentations: [new BunHttpInstrumentation()],
    });

    const response = await fetch(`${serverUrl}/not-found`);
    expect(response.status).toBe(404);

    const [serverSpan] = await tsdk.waitForSpans(1, 1000, s => s.server());

    // Per OTel spec, 4xx errors should NOT set span status to ERROR
    expect(serverSpan.status.code).toBe(SpanStatusCode.OK);
    expect(serverSpan.attributes["http.response.status_code"]).toBe(404);
  });

  test("5xx server errors set span status to ERROR", async () => {
    await using tsdk = new TestSDK({
      instrumentations: [new BunHttpInstrumentation()],
    });

    const response = await fetch(`${serverUrl}/error`);
    expect(response.status).toBe(500);

    const [serverSpan] = await tsdk.waitForSpans(1, 1000, s => s.server());

    // 5xx errors SHOULD set span status to ERROR
    expect(serverSpan.status.code).toBe(SpanStatusCode.ERROR);
    expect(serverSpan.attributes["http.response.status_code"]).toBe(500);
  });

  test("handles multiple concurrent requests", async () => {
    await using tsdk = new TestSDK({
      instrumentations: [new BunHttpInstrumentation()],
    });

    // Make 10 concurrent requests
    const promises = Array.from({ length: 10 }, (_, i) =>
      fetch(`${serverUrl}/hello`, {
        headers: { "x-request-id": `concurrent-${i}` },
      }),
    );

    const responses = await Promise.all(promises);
    expect(responses.every(r => r.ok)).toBe(true);

    const serverSpans = await tsdk.waitForSpans(10, 1000, s => s.server());

    // Should have 10 SERVER spans
    expect(serverSpans.length).toBe(10);

    // Each should have unique span ID
    const spanIds = serverSpans.map(s => s.spanContext().spanId);
    expect(new Set(spanIds).size).toBe(10);
  });

  test("disable() detaches instrumentation", () => {
    const inst = new BunHttpInstrumentation();
    using tsdk = new TestSDK({
      instrumentations: [inst],
    });

    // Should have an instrument ID after enable
    expect((inst as any)._instrumentId).toBeDefined();

    inst.disable();

    // Should clear instrument ID after disable
    expect((inst as any)._instrumentId).toBeUndefined();
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
    await using tsdk = new TestSDK({
      instrumentations: [new BunHttpInstrumentation()],
    });

    await fetch(`${serverUrl}/hello?foo=bar&baz=qux`);

    const [serverSpan] = await tsdk.waitForSpans(1, 1000, s => s.server());

    expect(serverSpan.attributes["url.query"]).toBe("foo=bar&baz=qux");
    expect(serverSpan.attributes["url.path"]).toBe("/hello");
  });

  test("handles POST requests with body", async () => {
    await using tsdk = new TestSDK({
      instrumentations: [new BunHttpInstrumentation()],
    });

    const response = await fetch(`${serverUrl}/json`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ test: "data" }),
    });

    expect(response.ok).toBe(true);

    const [serverSpan] = await tsdk.waitForSpans(1, 1000, s => s.server());

    expect(serverSpan.attributes["http.request.method"]).toBe("POST");
    expect(serverSpan.attributes["url.path"]).toBe("/json");
  });
});
