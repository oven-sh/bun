import {
  ATTR_HTTP_REQUEST_HEADER,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_URL_PATH,
} from "@opentelemetry/semantic-conventions";
import { describe, expect, test } from "bun:test";
import http from "node:http";
import { makeUninstrumentedRequest, TestSDK } from "./test-utils";
describe("Node.js http.createServer integration", () => {
  test("creates spans for Node.js http server requests", async () => {
    await using tsdk = new TestSDK();

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

    const response = await fetch(`http://localhost:${port}/test`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Node.js server");

    const [span] = await tsdk.waitForSpans(1, 1000, s => s.server());
    expect(span).toHaveSpanName("GET /test");
    expect(span).toHaveAttribute(ATTR_HTTP_REQUEST_METHOD, "GET");
    expect(span).toHaveAttribute(ATTR_URL_PATH, "/test");
    expect(span).toHaveAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, 200);
  });

  test("extracts headers from IncomingMessage correctly", async () => {
    await using tsdk = new TestSDK();

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

    await makeUninstrumentedRequest(`http://localhost:${port}/api/users/123`, {
      "User-Agent": "TestAgent/1.0",
      "Content-Length": "42",
    });

    const spans = await tsdk.waitForSpans(1, 1000, s => s.server());
    expect(spans[0]).toHaveAttribute(ATTR_HTTP_REQUEST_HEADER("user-agent"), "TestAgent/1.0");
    expect(spans[0]).toHaveAttribute(ATTR_URL_PATH, "/api/users/123");
  });

  test("auto-generates OpId starting from 1 and maintains consistency across calls", async () => {
    const capturedOpIds: { start: number[]; inject: number[] } = { start: [], inject: [] };

    await using tsdk = new TestSDK();

    // Manually attach a custom instrumentation to capture OpIds
    using instrument = Bun.telemetry.attach({
      type: "node",
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

    // Make first request
    await makeUninstrumentedRequest(`http://localhost:${port}/request1`);

    // Make second request
    await makeUninstrumentedRequest(`http://localhost:${port}/request2`);

    await tsdk.waitForSpans(2, 1000, s => s.server());
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
  });
});
