import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "bun:test";
import { BunSDK } from "../index";
import { makeUninstrumentedRequest, waitForSpans } from "./test-utils";

describe("Custom span matchers", () => {
  test("toHaveAttributes - should match all attributes", async () => {
    const exporter = new InMemorySpanExporter();
    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
    sdk.start();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });

    await makeUninstrumentedRequest(`http://localhost:${server.port}/test`);
    const spans = await waitForSpans(exporter, 1);

    expect(spans[0]).toHaveAttributes({
      "http.request.method": "GET",
      "http.response.status_code": 200,
    });

    await sdk.shutdown();
  });

  test("toHaveAttribute - should match single attribute", async () => {
    const exporter = new InMemorySpanExporter();
    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
    sdk.start();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });

    await makeUninstrumentedRequest(`http://localhost:${server.port}/test`);
    const spans = await waitForSpans(exporter, 1);

    expect(spans[0]).toHaveAttribute("http.request.method", "GET");
    expect(spans[0]).toHaveAttribute("http.request.method"); // without value check

    await sdk.shutdown();
  });

  test("toHaveSpanKind - should match span kind", async () => {
    const exporter = new InMemorySpanExporter();
    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
    sdk.start();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });

    await makeUninstrumentedRequest(`http://localhost:${server.port}/test`);
    const spans = await waitForSpans(exporter, 1);

    expect(spans[0]).toHaveSpanKind(SpanKind.SERVER);

    await sdk.shutdown();
  });

  test("toHaveSpanName - should match span name", async () => {
    const exporter = new InMemorySpanExporter();
    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
    sdk.start();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });

    await makeUninstrumentedRequest(`http://localhost:${server.port}/users`);
    const spans = await waitForSpans(exporter, 1);

    expect(spans[0]).toHaveSpanName("GET /users");

    await sdk.shutdown();
  });

  test("toHaveStatusCode - should match status code", async () => {
    const exporter = new InMemorySpanExporter();
    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
    sdk.start();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok", { status: 200 });
      },
    });

    await makeUninstrumentedRequest(`http://localhost:${server.port}/test`);
    const spans = await waitForSpans(exporter, 1);

    expect(spans[0]).toHaveStatusCode(SpanStatusCode.OK);

    await sdk.shutdown();
  });
});
