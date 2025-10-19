import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "bun:test";
import { BunSDK } from "./index";
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
});
