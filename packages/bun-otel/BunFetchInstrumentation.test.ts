import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_URL_FULL,
  SEMATTRS_HTTP_METHOD,
  SEMATTRS_HTTP_STATUS_CODE,
  SEMATTRS_HTTP_URL,
} from "@opentelemetry/semantic-conventions";
import { describe, expect, test } from "bun:test";
import { BunSDK } from "./bun-sdk";
import { BunFetchInstrumentation } from "./BunFetchInstrumentation";

describe("BunFetchInstrumentation - Span Naming", () => {
  test("uses HTTP method only in span name (not URL)", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "span-naming-test",
      instrumentations: [new BunFetchInstrumentation()],
    });

    sdk.start();

    await fetch("https://example.com/api/users");
    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);

    const span = spans[0];
    expect(span.name).toBe("HTTP GET");
    expect(span.name).not.toContain("example.com");
    expect(span.name).not.toContain("/api/users");
  });

  test("POST requests use correct span name", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "span-naming-post",
      instrumentations: [new BunFetchInstrumentation()],
    });

    sdk.start();

    try {
      await fetch("https://httpbin.org/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: "data" }),
      });
    } catch {
      // Ignore network errors
    }

    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);

    expect(spans[0].name).toBe("HTTP POST");
  });
});

describe("BunFetchInstrumentation - Semconv Stability", () => {
  test("default (no config): emits BOTH old and stable (http/dup)", async () => {
    const exporter = new InMemorySpanExporter();

    // No semconvStabilityOptIn config and no env var = default to 'http/dup'
    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "semconv-default-test",
      instrumentations: [new BunFetchInstrumentation()],
    });

    sdk.start();

    await fetch("https://example.com/");
    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);

    const attrs = spans[0].attributes;

    // Both OLD and STABLE attributes should exist (http/dup is default)
    expect(attrs[SEMATTRS_HTTP_METHOD]).toBe("GET");
    expect(attrs[SEMATTRS_HTTP_URL]).toBe("https://example.com/");
    expect(attrs[SEMATTRS_HTTP_STATUS_CODE]).toBe(200);

    expect(attrs[ATTR_HTTP_REQUEST_METHOD]).toBe("GET");
    expect(attrs[ATTR_URL_FULL]).toBe("https://example.com/");
    expect(attrs[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBe(200);
  });

  test("explicit config 'old': emits OLD attributes only", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "semconv-old-test",
      instrumentations: [
        new BunFetchInstrumentation({
          semconvStabilityOptIn: "old",
        }),
      ],
    });

    sdk.start();

    await fetch("https://example.com/");
    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);

    const attrs = spans[0].attributes;

    // OLD attributes should exist
    expect(attrs[SEMATTRS_HTTP_METHOD]).toBe("GET");
    expect(attrs[SEMATTRS_HTTP_URL]).toBe("https://example.com/");
    expect(attrs[SEMATTRS_HTTP_STATUS_CODE]).toBe(200);

    // STABLE attributes should NOT exist
    expect(attrs[ATTR_HTTP_REQUEST_METHOD]).toBeUndefined();
    expect(attrs[ATTR_URL_FULL]).toBeUndefined();
    expect(attrs[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBeUndefined();
  });

  test("programmatic config 'http': emits STABLE attributes only", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "semconv-stable-test",
      instrumentations: [
        new BunFetchInstrumentation({
          semconvStabilityOptIn: "http",
        }),
      ],
    });

    sdk.start();

    await fetch("https://example.com/");
    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);

    const attrs = spans[0].attributes;

    // STABLE attributes should exist
    expect(attrs[ATTR_HTTP_REQUEST_METHOD]).toBe("GET");
    expect(attrs[ATTR_URL_FULL]).toBe("https://example.com/");
    expect(attrs[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBe(200);

    // OLD attributes should NOT exist
    expect(attrs[SEMATTRS_HTTP_METHOD]).toBeUndefined();
    expect(attrs[SEMATTRS_HTTP_URL]).toBeUndefined();
    expect(attrs[SEMATTRS_HTTP_STATUS_CODE]).toBeUndefined();
  });

  test("programmatic config 'http/dup': emits BOTH old and stable", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "semconv-dup-test",
      instrumentations: [
        new BunFetchInstrumentation({
          semconvStabilityOptIn: "http/dup",
        }),
      ],
    });

    sdk.start();

    await fetch("https://example.com/");
    await Bun.sleep(100);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);

    const attrs = spans[0].attributes;

    // Both OLD and STABLE attributes should exist
    expect(attrs[SEMATTRS_HTTP_METHOD]).toBe("GET");
    expect(attrs[SEMATTRS_HTTP_URL]).toBe("https://example.com/");
    expect(attrs[SEMATTRS_HTTP_STATUS_CODE]).toBe(200);

    expect(attrs[ATTR_HTTP_REQUEST_METHOD]).toBe("GET");
    expect(attrs[ATTR_URL_FULL]).toBe("https://example.com/");
    expect(attrs[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBe(200);
  });

  test("programmatic config takes precedence over env var", async () => {
    const exporter = new InMemorySpanExporter();

    // Even if env var says 'http/dup', programmatic 'http' wins
    const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN;
    process.env.OTEL_SEMCONV_STABILITY_OPT_IN = "http/dup";

    try {
      await using sdk = new BunSDK({
        spanProcessor: new SimpleSpanProcessor(exporter),
        serviceName: "semconv-precedence-test",
        instrumentations: [
          new BunFetchInstrumentation({
            semconvStabilityOptIn: "http", // Programmatic should win
          }),
        ],
      });

      sdk.start();

      await fetch("https://example.com/");
      await Bun.sleep(100);

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBeGreaterThanOrEqual(1);

      const attrs = spans[0].attributes;

      // Should have STABLE only (programmatic 'http' won)
      expect(attrs[ATTR_HTTP_REQUEST_METHOD]).toBe("GET");
      expect(attrs[SEMATTRS_HTTP_METHOD]).toBeUndefined();
    } finally {
      // Restore env var
      if (originalEnv === undefined) {
        delete process.env.OTEL_SEMCONV_STABILITY_OPT_IN;
      } else {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv;
      }
    }
  });
});
