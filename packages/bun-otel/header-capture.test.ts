import { Span } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { describe, expect, test } from "bun:test";
import { createBunTelemetryConfig } from "./otel-core";

// Helper to access span attributes (Span API doesn't type attributes)
function getSpanAttributes(span: Span | undefined): Record<string, unknown> {
  return (span as any)?.attributes as Record<string, unknown>;
}

describe("Header capture and normalization", () => {
  test("captures request headers with correct attribute naming", () => {
    const exporter = new InMemorySpanExporter();
    const tracerProvider = new NodeTracerProvider();
    tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));

    const { config, spans } = createBunTelemetryConfig({
      tracerProvider,
      requestHeaderAttributes: ["user-agent", "x-request-id", "accept-language"],
    });

    // Simulate a request
    const mockRequest = new Request("http://localhost:3000/test", {
      headers: {
        "user-agent": "test-client/1.0",
        "x-request-id": "req-123",
        "accept-language": "en-US",
      },
    });

    config.onRequestStart?.(1, mockRequest);

    const span = spans.get(1);
    expect(span).toBeDefined();
    const attrs = getSpanAttributes(span);
    expect(attrs["http.request.header.user_agent"]).toBe("test-client/1.0");
    expect(attrs["http.request.header.x_request_id"]).toBe("req-123");
    expect(attrs["http.request.header.accept_language"]).toBe("en-US");
    config.onRequestEnd?.(1);
  });

  test("normalizes header names: dashes to underscores", () => {
    const exporter = new InMemorySpanExporter();
    const tracerProvider = new NodeTracerProvider();
    tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));

    const { config, spans } = createBunTelemetryConfig({
      tracerProvider,
      requestHeaderAttributes: ["content-type", "x-custom-header", "accept-encoding"],
    });

    const mockRequest = new Request("http://localhost:3000/test", {
      headers: {
        "content-type": "application/json",
        "x-custom-header": "custom-value",
        "accept-encoding": "gzip, deflate",
      },
    });

    config.onRequestStart?.(1, mockRequest);

    const span = spans.get(1);
    const attrs = getSpanAttributes(span);
    expect(attrs["http.request.header.content_type"]).toBe("application/json");
    expect(attrs["http.request.header.x_custom_header"]).toBe("custom-value");
    expect(attrs["http.request.header.accept_encoding"]).toBe("gzip, deflate");
    config.onRequestEnd?.(1);
  });

  test("captures response headers with correct attribute naming", () => {
    const exporter = new InMemorySpanExporter();
    const tracerProvider = new NodeTracerProvider();
    tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));

    const { config, spans } = createBunTelemetryConfig({
      tracerProvider,
      responseHeaderAttributes: ["content-type", "cache-control", "x-response-time"],
    });

    // Start request first
    const mockRequest = new Request("http://localhost:3000/test");
    config.onRequestStart?.(1, mockRequest);

    // Simulate response headers
    const mockHeaders = new Headers({
      "content-type": "application/json",
      "cache-control": "max-age=3600",
      "x-response-time": "42ms",
    });

    config.onResponseHeaders?.(1, 200, 123, mockHeaders);

    const span = spans.get(1);
    const attrs = getSpanAttributes(span);
    expect(attrs["http.response.header.content_type"]).toBe("application/json");
    expect(attrs["http.response.header.cache_control"]).toBe("max-age=3600");
    expect(attrs["http.response.header.x_response_time"]).toBe("42ms");
    config.onRequestEnd?.(1);
  });

  test("handles missing headers gracefully", () => {
    const exporter = new InMemorySpanExporter();
    const tracerProvider = new NodeTracerProvider();
    tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));

    const { config, spans } = createBunTelemetryConfig({
      tracerProvider,
      requestHeaderAttributes: ["user-agent", "x-missing-header", "authorization"],
    });

    const mockRequest = new Request("http://localhost:3000/test", {
      headers: {
        "user-agent": "test-client/1.0",
        // x-missing-header and authorization are not present
      },
    });

    config.onRequestStart?.(1, mockRequest);

    const span = spans.get(1);
    const attrs = getSpanAttributes(span);
    expect(attrs["http.request.header.user_agent"]).toBe("test-client/1.0");
    expect(attrs["http.request.header.x_missing_header"]).toBeUndefined();
    expect(attrs["http.request.header.authorization"]).toBeUndefined();
    config.onRequestEnd?.(1);
  });

  test("skips header capture when arrays are empty", () => {
    const exporter = new InMemorySpanExporter();
    const tracerProvider = new NodeTracerProvider();
    tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));

    const { config, spans } = createBunTelemetryConfig({
      tracerProvider,
      requestHeaderAttributes: [],
      responseHeaderAttributes: [],
    });

    const mockRequest = new Request("http://localhost:3000/test", {
      headers: { "user-agent": "test" },
    });

    config.onRequestStart?.(1, mockRequest);

    const span = spans.get(1);
    const attrs = getSpanAttributes(span);
    // Only standard attributes should exist
    expect(attrs["http.method"]).toBeDefined();
    expect(attrs["http.request.header.user_agent"]).toBeUndefined();
    config.onRequestEnd?.(1);
  });

  test("handles case-insensitive header lookup", () => {
    const exporter = new InMemorySpanExporter();
    const tracerProvider = new NodeTracerProvider();
    tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));

    const { config, spans } = createBunTelemetryConfig({
      tracerProvider,
      requestHeaderAttributes: ["Content-Type", "USER-AGENT"], // Mixed case
    });

    const mockRequest = new Request("http://localhost:3000/test", {
      headers: {
        "content-type": "text/html", // lowercase in actual request
        "user-agent": "browser/1.0",
      },
    });

    config.onRequestStart?.(1, mockRequest);

    const span = spans.get(1);
    const attrs = getSpanAttributes(span);
    // Normalized to lowercase with underscores
    expect(attrs["http.request.header.content_type"]).toBe("text/html");
    expect(attrs["http.request.header.user_agent"]).toBe("browser/1.0");
    config.onRequestEnd?.(1);
  });

  test("onResponseStart returns trace ID when enabled", () => {
    const tracerProvider = new NodeTracerProvider();

    const { config, spans } = createBunTelemetryConfig({
      tracerProvider,
      correlationHeaderName: "x-trace-id",
    });

    const mockRequest = new Request("http://localhost:3000/test");
    config.onRequestStart?.(1, mockRequest);

    const headers = config.onResponseStart?.(1);
    expect(headers).toBeDefined();
    expect(headers).toBeArrayOfSize(1); // Only value, not key-value pair
    expect(headers?.[0]).toMatch(/^[0-9a-f]{32}$/); // 32-char hex trace ID
  });

  test("onResponseStart returns undefined when correlation disabled", () => {
    const tracerProvider = new NodeTracerProvider();

    const { config } = createBunTelemetryConfig({
      tracerProvider,
      correlationHeaderName: false, // Disabled
    });

    const mockRequest = new Request("http://localhost:3000/test");
    config.onRequestStart?.(1, mockRequest);

    const headers = config.onResponseStart?.(1);
    expect(headers).toBeUndefined();
  });

  test("onResponseStart returns undefined for missing span", () => {
    const tracerProvider = new NodeTracerProvider();

    const { config } = createBunTelemetryConfig({
      tracerProvider,
      correlationHeaderName: "x-trace-id",
    });

    // Don't create span, just call onResponseStart
    const headers = config.onResponseStart?.(999); // Non-existent ID
    expect(headers).toBeUndefined();
  });

  test("uses custom correlation header name", () => {
    const tracerProvider = new NodeTracerProvider();

    const { config } = createBunTelemetryConfig({
      tracerProvider,
      correlationHeaderName: "x-custom-trace", // Custom name
    });

    const mockRequest = new Request("http://localhost:3000/test");
    config.onRequestStart?.(1, mockRequest);

    const headers = config.onResponseStart?.(1);
    expect(headers).toBeArrayOfSize(1); // Only value
    expect(headers?.[0]).toMatch(/^[0-9a-f]{32}$/); // Trace ID
    // Header name is now in config.correlationHeaderNames, not in return value
    expect(config.correlationHeaderNames).toEqual(["x-custom-trace"]);
  });

  test("captures multiple request headers efficiently", () => {
    const tracerProvider = new NodeTracerProvider();

    const { config, spans } = createBunTelemetryConfig({
      tracerProvider,
      requestHeaderAttributes: [
        "user-agent",
        "accept",
        "accept-language",
        "accept-encoding",
        "x-request-id",
        "x-correlation-id",
        "authorization",
      ],
    });

    const mockRequest = new Request("http://localhost:3000/test", {
      headers: {
        "user-agent": "client/1.0",
        "accept": "application/json",
        "accept-language": "en",
        "accept-encoding": "gzip",
        "x-request-id": "req-1",
        "x-correlation-id": "corr-1",
        // authorization missing
      },
    });

    config.onRequestStart?.(1, mockRequest);

    const span = spans.get(1);
    const attrs = getSpanAttributes(span);
    expect(attrs["http.request.header.user_agent"]).toBe("client/1.0");
    expect(attrs["http.request.header.accept"]).toBe("application/json");
    expect(attrs["http.request.header.accept_language"]).toBe("en");
    expect(attrs["http.request.header.accept_encoding"]).toBe("gzip");
    expect(attrs["http.request.header.x_request_id"]).toBe("req-1");
    expect(attrs["http.request.header.x_correlation_id"]).toBe("corr-1");
    expect(attrs["http.request.header.authorization"]).toBeUndefined();
    config.onRequestEnd?.(1);
  });

  test("captures multiple response headers efficiently", () => {
    const tracerProvider = new NodeTracerProvider();

    const { config, spans } = createBunTelemetryConfig({
      tracerProvider,
      responseHeaderAttributes: [
        "content-type",
        "content-length",
        "cache-control",
        "etag",
        "x-response-time",
        "x-rate-limit-remaining",
      ],
    });

    const mockRequest = new Request("http://localhost:3000/test");
    config.onRequestStart?.(1, mockRequest);

    const mockHeaders = new Headers({
      "content-type": "application/json",
      "content-length": "1234",
      "cache-control": "no-cache",
      "etag": '"abc123"',
      "x-response-time": "15ms",
      // x-rate-limit-remaining missing
    });

    config.onResponseHeaders?.(1, 200, 1234, mockHeaders);

    const span = spans.get(1);
    const attrs = getSpanAttributes(span);
    expect(attrs["http.response.header.content_type"]).toBe("application/json");
    expect(attrs["http.response.header.content_length"]).toBe("1234");
    expect(attrs["http.response.header.cache_control"]).toBe("no-cache");
    expect(attrs["http.response.header.etag"]).toBe('"abc123"');
    expect(attrs["http.response.header.x_response_time"]).toBe("15ms");
    expect(attrs["http.response.header.x_rate_limit_remaining"]).toBeUndefined();
    config.onRequestEnd?.(1);
  });
});
