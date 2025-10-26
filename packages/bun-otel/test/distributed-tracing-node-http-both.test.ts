import { context, SpanKind, trace } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as http from "node:http";
import { afterUsingEchoServer, beforeUsingEchoServer, getEchoServer, TestSDK } from "./test-utils";

/**
 * Tests trace propagation: uninstrumented client → UUT (http.createServer) → http.request → echo server
 *
 * This verifies that:
 * 1. http.createServer receives traceparent and creates a SERVER span
 * 2. http.request within the handler creates a CLIENT span as child of SERVER span
 * 3. Trace context propagates correctly through Node.js AsyncLocalStorage
 */
describe("Distributed tracing: http.createServer → http.request", () => {
  beforeAll(beforeUsingEchoServer);
  afterAll(afterUsingEchoServer);

  test("context.active() returns the correct span in http.createServer handler", async () => {
    await using tsdk = new TestSDK({
      serviceName: "node-http-context-active-test",
      // Don't pass instrumentations - let BunSDK auto-register with shared contextStorage
    });

    let capturedTraceId: string | undefined;
    let capturedSpanId: string | undefined;

    await using server = http.createServer((req, res) => {
      // Synchronously check context.active() to verify span is available
      const activeSpan = trace.getSpan(context.active());
      capturedTraceId = activeSpan?.spanContext().traceId;
      capturedSpanId = activeSpan?.spanContext().spanId;
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

    const upstreamTraceId = "1234567890abcdef1234567890abcdef";
    const upstreamSpanId = "fedcba0987654321";
    const traceparent = `00-${upstreamTraceId}-${upstreamSpanId}-01`;

    await using echoServer = await getEchoServer();
    await echoServer.fetch(`http://localhost:${port}/test`, { headers: { traceparent } });

    const spans = await tsdk.waitForSpans(1, 500, s => s.server().withTraceId(upstreamTraceId));
    expect(spans).toHaveLength(1);

    const serverSpan = spans[0];

    // Verify context.active() returned the correct span
    expect(capturedTraceId).toBe(upstreamTraceId);
    expect(capturedSpanId).toBe(serverSpan.spanContext().spanId);
    expect(serverSpan.parentSpanContext?.spanId).toBe(upstreamSpanId);
  });

  test("propagates trace context: http.createServer → http.request → echo server", async () => {
    await using tsdk = new TestSDK({
      serviceName: "node-http-both-test",
      // Don't pass instrumentations - let BunSDK auto-register with shared contextStorage
    });

    // UUT: http.createServer that makes http.request to echo server
    await using serverA = http.createServer(async (req, res) => {
      try {
        await using echoServer = await getEchoServer();
        const echoUrl = new URL(echoServer.echoUrlStr("/downstream"));

        // Make outgoing request using http.request
        const response = await new Promise<string>((resolve, reject) => {
          const clientReq = http.request(
            {
              hostname: echoUrl.hostname,
              port: echoUrl.port,
              path: echoUrl.pathname,
              method: "GET",
            },
            httpRes => {
              let data = "";
              httpRes.on("data", chunk => (data += chunk));
              httpRes.on("end", () => resolve(data));
            },
          );
          clientReq.on("error", reject);
          clientReq.end();
        });

        const data = JSON.parse(response);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ downstream: data }));
      } catch (error) {
        res.writeHead(500);
        res.end("Error");
      }
    });

    await new Promise<void>((resolve, reject) => {
      serverA.listen(0, () => resolve());
      serverA.on("error", reject);
    });

    const address = serverA.address();
    if (!address || typeof address === "string") {
      throw new Error("Server address not available");
    }

    const port = address.port;

    const upstreamTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const upstreamSpanId = "00f067aa0ba902b7";
    const traceparent = `00-${upstreamTraceId}-${upstreamSpanId}-01`;

    await using echoServer = await getEchoServer();
    const response = await echoServer.fetch(`http://localhost:${port}/upstream`, {
      headers: { traceparent },
    });
    const result = await response.json();

    // Wait for 2 spans: http.createServer (SERVER) + http.request (CLIENT)
    const allSpans = await tsdk.waitForSpans(2, 500, s => s.withTraceId(upstreamTraceId));
    expect(allSpans).toHaveLength(2);

    const serverSpan = allSpans.server()[0];
    const clientSpan = allSpans.client()[0];

    // CRITICAL ASSERTIONS for distributed tracing:
    // 1. Both spans share the same trace ID (distributed trace)
    expect(serverSpan.spanContext().traceId).toBe(upstreamTraceId);
    expect(clientSpan.spanContext().traceId).toBe(upstreamTraceId);

    // 2. Server span is a child of the incoming request
    expect(serverSpan.parentSpanContext?.spanId).toBe(upstreamSpanId);

    // 3. CLIENT span (http.request) is a child of server span
    expect(clientSpan.parentSpanContext?.spanId).toBe(serverSpan.spanContext().spanId);

    // 4. Verify traceparent was injected into http.request (echo returns headers)
    expect(result.downstream.headers.traceparent).toBeDefined();
    expect(result.downstream.headers.traceparent).toContain(upstreamTraceId);
    expect(result.downstream.headers.traceparent).toContain(clientSpan.spanContext().spanId);

    // 5. Verify span names and kinds
    expect(serverSpan.name).toBe("GET /upstream");
    expect(serverSpan.kind).toBe(SpanKind.SERVER);
    expect(clientSpan.name).toBe("GET");
    expect(clientSpan.kind).toBe(SpanKind.CLIENT);
  });

  test("propagates trace context across setTimeout: http.createServer → http.request", async () => {
    await using tsdk = new TestSDK({
      serviceName: "node-http-settimeout-test",
      // Don't pass instrumentations - let BunSDK auto-register with shared contextStorage
    });

    await using server = http.createServer(async (req, res) => {
      try {
        // Delay http.request with setTimeout
        const echoData = await new Promise<any>(resolve => {
          setTimeout(async () => {
            await using echoServer = await getEchoServer();
            const echoUrl = new URL(echoServer.echoUrlStr("/delayed"));
            const response = await new Promise<string>((res, rej) => {
              const clientReq = http.request(
                {
                  hostname: echoUrl.hostname,
                  port: echoUrl.port,
                  path: echoUrl.pathname,
                  method: "GET",
                },
                httpRes => {
                  let data = "";
                  httpRes.on("data", chunk => (data += chunk));
                  httpRes.on("end", () => res(data));
                },
              );
              clientReq.on("error", rej);
              clientReq.end();
            });
            resolve(JSON.parse(response));
          }, 10);
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(echoData));
      } catch (error) {
        res.writeHead(500);
        res.end("Error");
      }
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

    const upstreamTraceId = "ccddee112233445566778899aabbccdd";
    const upstreamSpanId = "aabbccdd11223344";
    const traceparent = `00-${upstreamTraceId}-${upstreamSpanId}-01`;

    await using echoServer2 = await getEchoServer();
    const response = await echoServer2.fetch(`http://localhost:${port}/test`, {
      headers: { traceparent },
    });
    const echoData = await response.json();

    const spans = await tsdk.waitForSpans(2, 500, s => s.withTraceId(upstreamTraceId));
    expect(spans).toHaveLength(2);

    const serverSpan = spans.server()[0];
    const clientSpan = spans.client()[0];

    // CRITICAL: CLIENT span created inside setTimeout should still be child of server span
    // This proves AsyncLocalStorage context propagates across async boundaries
    expect(serverSpan.spanContext().traceId).toBe(upstreamTraceId);
    expect(clientSpan.spanContext().traceId).toBe(upstreamTraceId);
    expect(clientSpan.parentSpanContext?.spanId).toBe(serverSpan.spanContext().spanId);

    // Verify traceparent was injected
    expect(echoData.headers.traceparent).toBeDefined();
    expect(echoData.headers.traceparent).toContain(upstreamTraceId);
    expect(echoData.headers.traceparent).toContain(clientSpan.spanContext().spanId);
  });

  test("propagates trace context through parallel http.request calls in http.createServer", async () => {
    await using tsdk = new TestSDK({
      serviceName: "node-http-parallel-test",
      // Don't pass instrumentations - let BunSDK auto-register with shared contextStorage
    });

    await using gateway = http.createServer(async (req, res) => {
      try {
        await using echoServer = await getEchoServer();
        // Make 3 parallel http.request calls
        const makeRequest = (path: string) =>
          new Promise<any>((resolve, reject) => {
            const echoUrl = new URL(echoServer.echoUrlStr(path));
            const clientReq = http.request(
              {
                hostname: echoUrl.hostname,
                port: echoUrl.port,
                path: echoUrl.pathname,
                method: "GET",
              },
              httpRes => {
                let data = "";
                httpRes.on("data", chunk => (data += chunk));
                httpRes.on("end", () => resolve(JSON.parse(data)));
              },
            );
            clientReq.on("error", reject);
            clientReq.end();
          });

        const [r1, r2, r3] = await Promise.all([
          makeRequest("/service1"),
          makeRequest("/service2"),
          makeRequest("/service3"),
        ]);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results: [r1, r2, r3] }));
      } catch (error) {
        res.writeHead(500);
        res.end("Error");
      }
    });

    await new Promise<void>((resolve, reject) => {
      gateway.listen(0, () => resolve());
      gateway.on("error", reject);
    });

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Server address not available");
    }

    const port = address.port;

    const traceId = "99aabbccddee0011223344556677ff88";
    const traceparent = `00-${traceId}-9988776655443322-01`;

    await using echoServer2 = await getEchoServer();
    const response = await echoServer2.fetch(`http://localhost:${port}/gateway`, {
      headers: { traceparent },
    });
    const result = await response.json();

    // Wait for 1 gateway (SERVER) + 3 http.request (CLIENT) = 4 spans
    const allSpans = await tsdk.waitForSpans(4, 500, s => s.withTraceId(traceId));
    expect(allSpans).toHaveLength(4);

    const gatewaySpan = allSpans.server().withName("GET /gateway")[0];
    expect(gatewaySpan).toBeDefined();

    const clientSpans = allSpans.client();
    expect(clientSpans).toHaveLength(3);

    // All 3 http.request CLIENT spans should be children of the gateway span
    for (const clientSpan of clientSpans) {
      expect(clientSpan.parentSpanContext?.spanId).toBe(gatewaySpan!.spanContext().spanId);
    }

    // Verify traceparent was injected in all 3 parallel requests
    for (const serviceResult of result.results) {
      expect(serviceResult.headers.traceparent).toBeDefined();
      expect(serviceResult.headers.traceparent).toContain(traceId);
    }
  });
});
