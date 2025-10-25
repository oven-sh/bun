import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "bun:test";
import { BunSDK } from "../index";
import { waitForSpans } from "./test-utils";

describe("Node.js http.createServer integration", () => {
  test("creates spans for Node.js http server requests", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    const http = await import("node:http");
    await using server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Node.js server");
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
      const response = await fetch(`http://localhost:${port}/test`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("Node.js server");

      await waitForSpans(exporter, 1);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("GET /test");
      expect(spans[0].attributes["http.method"]).toBe("GET");
      expect(spans[0].attributes["http.target"]).toBe("/test");
      expect(spans[0].attributes["http.status_code"]).toBe(200);
    } finally {
      await sdk.shutdown();
    }
  });

  test("extracts headers from IncomingMessage correctly", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
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

    try {
      await fetch(`http://localhost:${port}/api/users/123`, {
        headers: {
          "User-Agent": "TestAgent/1.0",
          "Content-Length": "42",
        },
      });

      await waitForSpans(exporter, 1);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);

      const span = spans[0];
      expect(span.attributes["http.user_agent"]).toBe("TestAgent/1.0");
      expect(span.attributes["http.target"]).toBe("/api/users/123");
      expect(span.attributes["http.host"]).toContain("localhost");
    } finally {
      await sdk.shutdown();
    }
  });

  test("auto-generates OpId starting from 1 and maintains consistency across calls", async () => {
    const exporter = new InMemorySpanExporter();
    const capturedOpIds: { start: number[]; inject: number[] } = { start: [], inject: [] };

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    // Manually attach a custom instrumentation to capture OpIds
    using instrument = Bun.telemetry.attach({
      type: 6, // InstrumentKind.Node
      name: "test-opid-capture",
      version: "1.0.0",
      onOperationStart: (id: number, _attributes: Record<string, any>) => {
        capturedOpIds.start.push(id);
      },
      onOperationInject: (id: number, _data?: unknown) => {
        capturedOpIds.inject.push(id);
        return undefined;
      },
    });

    const http = await import("node:http");
    await using server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OpId test");
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
      // Make first request
      const response1 = await fetch(`http://localhost:${port}/request1`);
      expect(response1.status).toBe(200);

      // Make second request
      const response2 = await fetch(`http://localhost:${port}/request2`);
      expect(response2.status).toBe(200);

      await waitForSpans(exporter, 2);

      // Verify OpIds were captured
      expect(capturedOpIds.start.length).toBeGreaterThanOrEqual(2);
      expect(capturedOpIds.inject.length).toBeGreaterThanOrEqual(2);

      // First OpId should be >= 1 (not 0)
      expect(capturedOpIds.start[0]).toBeGreaterThanOrEqual(1);
      expect(capturedOpIds.inject[0]).toBeGreaterThanOrEqual(1);

      // Same OpId should be used for start and inject of the same request
      expect(capturedOpIds.start[0]).toBe(capturedOpIds.inject[0]);
      expect(capturedOpIds.start[1]).toBe(capturedOpIds.inject[1]);

      // Different requests should have different OpIds
      expect(capturedOpIds.start[0]).not.toBe(capturedOpIds.start[1]);
    } finally {
      await sdk.shutdown();
    }
  });
});
