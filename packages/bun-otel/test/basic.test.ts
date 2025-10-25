import { SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "bun:test";
import { BunSDK } from "../index";
import { makeUninstrumentedRequest, waitForSpans } from "./test-utils";

describe("BunSDK basic functionality", () => {
  test("creates spans for HTTP requests", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    // Use curl to avoid creating a CLIENT span from fetch instrumentation
    const response = await makeUninstrumentedRequest(`http://localhost:${server.port}/`);
    expect(response).toContain("test");

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("GET /");
    expect(spans[0].attributes["http.request.method"]).toBe("GET");
    expect(spans[0].attributes["http.response.status_code"]).toBe(200);

    await sdk.shutdown();
  });

  test("ERROR status from 5xx is not overwritten by onRequestEnd", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Server Error", { status: 500 });
      },
    });

    // Use curl to avoid creating a CLIENT span from fetch instrumentation
    // curl will succeed even with 500 status (it's not an HTTP error from curl's perspective)
    await makeUninstrumentedRequest(`http://localhost:${server.port}/error`);

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("GET /error");
    expect(spans[0].attributes["http.response.status_code"]).toBe(500);

    // Verify ERROR status is preserved (not overwritten with OK by onRequestEnd)
    // This test would fail without the fix - onRequestEnd would set OK unconditionally
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);

    await sdk.shutdown();
  });
});
