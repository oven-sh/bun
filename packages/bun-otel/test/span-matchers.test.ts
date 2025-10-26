import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TestSDK, afterUsingEchoServer, beforeUsingEchoServer, makeUninstrumentedRequest } from "./test-utils";

describe("Custom span matchers", () => {
  beforeAll(beforeUsingEchoServer);
  afterAll(afterUsingEchoServer);

  test("toHaveAttributes - should match all attributes", async () => {
    await using tsdk = new TestSDK();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });

    await makeUninstrumentedRequest(`http://localhost:${server.port}/test`);
    const spans = await tsdk.waitForSpans(1);

    expect(spans[0]).toHaveAttributes({
      "http.request.method": "GET",
      "http.response.status_code": 200,
    });
  });

  test("toHaveAttribute - should match single attribute", async () => {
    await using tsdk = new TestSDK();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });

    await makeUninstrumentedRequest(`http://localhost:${server.port}/test`);
    const spans = await tsdk.waitForSpans(1);

    expect(spans[0]).toHaveAttribute("http.request.method", "GET");
    expect(spans[0]).toHaveAttribute("http.request.method"); // without value check
  });

  test("toHaveSpanKind - should match span kind", async () => {
    await using tsdk = new TestSDK();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });

    await makeUninstrumentedRequest(`http://localhost:${server.port}/test`);
    const spans = await tsdk.waitForSpans(1);

    expect(spans[0]).toHaveSpanKind(SpanKind.SERVER);
  });

  test("toHaveSpanName - should match span name", async () => {
    await using tsdk = new TestSDK();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });

    await makeUninstrumentedRequest(`http://localhost:${server.port}/users`);
    const spans = await tsdk.waitForSpans(1);

    expect(spans[0]).toHaveSpanName("GET /users");
  });

  test("toHaveStatusCode - should match status code", async () => {
    await using tsdk = new TestSDK();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok", { status: 200 });
      },
    });

    await makeUninstrumentedRequest(`http://localhost:${server.port}/test`);
    const spans = await tsdk.waitForSpans(1);

    expect(spans[0]).toHaveStatusCode(SpanStatusCode.OK);
  });
});
