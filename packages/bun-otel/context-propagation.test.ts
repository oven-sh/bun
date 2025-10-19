import { propagation } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { beforeAll, describe, expect, test } from "bun:test";
import { BunSDK } from "./index";
import { waitForSpans } from "./test-utils";

describe("W3C trace context propagation", () => {
  // Set up W3C propagator for this suite only, avoiding test isolation issues
  beforeAll(() => {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });
  test("propagates trace context in Bun.serve", async () => {
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

    try {
      await fetch(`http://localhost:${server.port}/`, {
        headers: {
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        },
      });

      await waitForSpans(exporter, 1);

      const spans = exporter.getFinishedSpans();
      const spanContext = spans[0].spanContext();
      expect(spanContext.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    } finally {
      await sdk.shutdown();
    }
  });

  test("propagates trace context in Node.js http.createServer", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    const http = await import("node:http");
    const server = http.createServer((req, res) => {
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

    try {
      await fetch(`http://localhost:${port}/`, {
        headers: {
          traceparent: "00-abcdef1234567890abcdef1234567890-1234567890abcdef-01",
        },
      });

      await waitForSpans(exporter, 1);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);

      const spanContext = spans[0].spanContext();
      expect(spanContext.traceId).toBe("abcdef1234567890abcdef1234567890");
    } finally {
      await new Promise<void>(resolve => {
        server.close(() => resolve());
      });
      await sdk.shutdown();
    }
  });
});
