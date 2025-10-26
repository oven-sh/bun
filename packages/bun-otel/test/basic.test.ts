import { SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BunSDK } from "../index";
import { afterUsingEchoServer, beforeUsingEchoServer, getEchoServer, waitForSpans } from "./test-utils";

describe("BunSDK basic functionality", () => {
  beforeAll(beforeUsingEchoServer);
  afterAll(afterUsingEchoServer);

  test("creates spans for HTTP requests", async () => {
    await using echoServer = await getEchoServer();
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

    // Use remote control to avoid creating a CLIENT span from fetch instrumentation
    const response = await echoServer.fetch(`http://localhost:${server.port}/`);
    expect(await response.text()).toContain("test");

    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("GET /");
    expect(spans[0].attributes["http.request.method"]).toBe("GET");
    expect(spans[0].attributes["http.response.status_code"]).toBe(200);

    await sdk.shutdown();
  });

  test("ERROR status from 5xx is not overwritten by onRequestEnd", async () => {
    await using echoServer = await getEchoServer();
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

    // Use remote control to avoid creating a CLIENT span from fetch instrumentation
    await echoServer.fetch(`http://localhost:${server.port}/error`);

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
