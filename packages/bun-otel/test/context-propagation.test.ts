import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BunSDK } from "../index";
import { afterUsingEchoServer, beforeUsingEchoServer, makeUninstrumentedRequest, waitForSpans } from "./test-utils";

describe("W3C trace context propagation", () => {
  beforeAll(beforeUsingEchoServer);
  afterAll(afterUsingEchoServer);

  // Uses default W3C propagator installed by BunSDK.start()
  test("propagates trace context in Bun.serve", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    await makeUninstrumentedRequest(`http://localhost:${server.port}/`, {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    await waitForSpans(exporter, 1, 1000, { traceId: "4bf92f3577b34da6a3ce929d0e0e4736" });
    await fetch(`http://localhost:${server.port}/`, {
      headers: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
    });

    const spans = await waitForSpans(exporter, 1, 1000, s => s.withTraceId("4bf92f3577b34da6a3ce929d0e0e4736"));
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.spanContext().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(span.parentSpanContext?.spanId).toBe("00f067aa0ba902b7");
    expect(span.spanContext().spanId).not.toBe("00f067aa0ba902b7"); // should be a new span ID
  });

  test("propagates trace context in Node.js http.createServer", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    const http = await import("node:http");
    await using server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("OK");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => resolve());
      server.on("error", reject);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server address not available");
    }

    const port = address.port;
    await makeUninstrumentedRequest(`http://localhost:${port}/`, {
      traceparent: "00-abcdef1234567890abcdef1234567890-1234567890abcdef-01",
    });
    const spans = await waitForSpans(exporter, 1, 1000, { traceId: "abcdef1234567890abcdef1234567890" });

    expect(spans).toHaveLength(1);

    const span = spans[0];
    expect(span.spanContext().traceId).toBe("abcdef1234567890abcdef1234567890");
    expect(span.parentSpanContext?.spanId).toBe("1234567890abcdef");
    expect(span.spanContext().spanId).not.toBe("1234567890abcdef"); // should be a new span ID
  });
});
