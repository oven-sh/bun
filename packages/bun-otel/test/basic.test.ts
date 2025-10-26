import { SpanStatusCode } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TestSDK, afterUsingEchoServer, beforeUsingEchoServer, getEchoServer } from "./test-utils";

describe("BunSDK basic functionality", () => {
  beforeAll(beforeUsingEchoServer);
  afterAll(afterUsingEchoServer);

  test("creates spans for HTTP requests", async () => {
    await using echoServer = await getEchoServer();
    await using tsdk = new TestSDK();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    // Use remote control to avoid creating a CLIENT span from fetch instrumentation
    const response = await echoServer.fetch(`http://localhost:${server.port}/`);
    expect(await response.text()).toContain("test");

    const spans = await tsdk.waitForSpans(1);
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("GET /");
    expect(spans[0].attributes["http.request.method"]).toBe("GET");
    expect(spans[0].attributes["http.response.status_code"]).toBe(200);
  });

  test("ERROR status from 5xx is not overwritten by onRequestEnd", async () => {
    await using echoServer = await getEchoServer();
    await using tsdk = new TestSDK();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Server Error", { status: 500 });
      },
    });

    // Use remote control to avoid creating a CLIENT span from fetch instrumentation
    await echoServer.fetch(`http://localhost:${server.port}/error`);

    const spans = await tsdk.waitForSpans(1);
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("GET /error");
    expect(spans[0].attributes["http.response.status_code"]).toBe(500);

    // Verify ERROR status is preserved (not overwritten with OK by onRequestEnd)
    // This test would fail without the fix - onRequestEnd would set OK unconditionally
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
  });
});
