import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_URL_FULL,
  SEMATTRS_HTTP_METHOD,
  SEMATTRS_HTTP_STATUS_CODE,
  SEMATTRS_HTTP_URL,
} from "@opentelemetry/semantic-conventions";
import { expect, test } from "bun:test";
import { BunSDK } from "./bun-sdk";
import { BunFetchInstrumentation } from "./BunFetchInstrumentation";

test("BunFetchInstrumentation uses correct span naming and dual semconv", async () => {
  const exporter = new InMemorySpanExporter();

  await using sdk = new BunSDK({
    spanProcessor: new SimpleSpanProcessor(exporter),
    serviceName: "semconv-test",
    instrumentations: [new BunFetchInstrumentation()],
  });

  sdk.start();

  // Make a fetch call (using a real endpoint to avoid test infrastructure issues)
  const response = await fetch("https://example.com/");
  expect(response.ok).toBe(true);

  // Wait a bit for span export
  await Bun.sleep(100);

  const spans = exporter.getFinishedSpans();
  expect(spans.length).toBeGreaterThanOrEqual(1);

  // Find the fetch span (should be the first one)
  const span = spans[0];

  // Verify span name is just "HTTP {method}" (not method + URL)
  expect(span.name).toBe("HTTP GET");
  expect(span.name).not.toContain("example.com"); // URL should NOT be in name
  expect(span.name).not.toContain("http://"); // Protocol should NOT be in name
  expect(span.name).not.toContain("https://"); // Protocol should NOT be in name

  // Verify both old and stable semconv attributes exist
  const attrs = span.attributes;

  // Old semconv (deprecated but still supported)
  expect(attrs[SEMATTRS_HTTP_METHOD]).toBe("GET");
  expect(attrs[SEMATTRS_HTTP_URL]).toBe("https://example.com/");
  expect(typeof attrs[SEMATTRS_HTTP_STATUS_CODE]).toBe("number");
  expect(attrs[SEMATTRS_HTTP_STATUS_CODE]).toBe(200);

  // Stable semconv (1.27+)
  expect(attrs[ATTR_HTTP_REQUEST_METHOD]).toBe("GET");
  expect(attrs[ATTR_URL_FULL]).toBe("https://example.com/");
  expect(typeof attrs[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBe("number");
  expect(attrs[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBe(200);
});

test("BunFetchInstrumentation uses correct span naming for POST requests", async () => {
  const exporter = new InMemorySpanExporter();

  await using sdk = new BunSDK({
    spanProcessor: new SimpleSpanProcessor(exporter),
    serviceName: "semconv-test-post",
    instrumentations: [new BunFetchInstrumentation()],
  });

  sdk.start();

  // Make a POST request
  try {
    await fetch("https://httpbin.org/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: "data" }),
    });
  } catch (error) {
    // Ignore network errors - we just want to verify span naming
  }

  // Wait a bit for span export
  await Bun.sleep(100);

  const spans = exporter.getFinishedSpans();
  expect(spans.length).toBeGreaterThanOrEqual(1);

  const span = spans[0];

  // Verify span name is "HTTP POST" (not "POST https://...")
  expect(span.name).toBe("HTTP POST");
  expect(span.name).not.toContain("httpbin.org");
  expect(span.name).not.toContain("/post");

  // Verify method in both old and stable semconv
  const attrs = span.attributes;
  expect(attrs[SEMATTRS_HTTP_METHOD]).toBe("POST");
  expect(attrs[ATTR_HTTP_REQUEST_METHOD]).toBe("POST");
  expect(attrs[SEMATTRS_HTTP_URL]).toBe("https://httpbin.org/post");
  expect(attrs[ATTR_URL_FULL]).toBe("https://httpbin.org/post");
});
