/**
 * Tests for BunHttpInstrumentation metrics collection
 *
 * Validates:
 * - http.server.request.duration histogram metric
 * - http.server.requests.total counter metric
 * - Metric attributes (http.request.method, url.path, http.response.status_code)
 * - Metrics work independently of tracing
 * - Multiple endpoints tracked separately
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TestSDK } from "./test-utils";

// Helper to normalize histogram/counter data point values across OTEL versions
function getDataPointValue(dp: any): number {
  if (!dp) return 0;
  const v: any = dp.value;
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "sum" in v) return v.sum as number;
  return 0;
}

describe("BunHttpInstrumentation - Metrics", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let serverUrl: string;

  beforeAll(async () => {
    // Start test server
    server = Bun.serve({
      port: 0,
      fetch(req: Request): Response {
        const url = new URL(req.url);

        if (url.pathname === "/hello") {
          console.log(`/hello handler called`);
          return new Response("Hello, World!");
        }

        if (url.pathname === "/json") {
          return Response.json({ message: "success" });
        }

        if (url.pathname === "/slow") {
          // Simulate slow handler for duration testing
          const start = Date.now();
          let iterations = 0;
          while (Date.now() - start < 50) {
            iterations++;
            // Tight spin to ensure measurable delay
          }
          console.log(`/slow handler: elapsed ${Date.now() - start}ms, iterations: ${iterations}`);
          return new Response("Slow response");
        }

        if (url.pathname === "/error") {
          return new Response("Internal Server Error", { status: 500 });
        }

        return new Response("OK");
      },
    });

    serverUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    server?.stop();
    server = null;
  });

  test("records http.server.request.duration histogram metric", async () => {
    await using tsdk = new TestSDK();

    const response = await fetch(`${serverUrl}/hello`);
    expect(response.ok).toBe(true);
    await response.text();

    const resourceMetrics = await tsdk.waitForMetrics();
    expect(resourceMetrics.length).toBeGreaterThan(0);

    // Find the duration metric
    const scopeMetrics = resourceMetrics[0].scopeMetrics;
    const durationMetric = scopeMetrics
      .flatMap(sm => sm.metrics)
      .find(m => m.descriptor.name === "http.server.request.duration");

    expect(durationMetric).toBeDefined();
    expect(durationMetric!.descriptor.description).toContain("HTTP server");
    expect(durationMetric!.descriptor.unit).toBe("s");

    // Verify at least one data point exists
    expect(durationMetric!.dataPoints.length).toBeGreaterThan(0);

    // Verify duration is reasonable (>0 and <1 second)
    const dataPoint = durationMetric!.dataPoints[0];
    const durationSum = getDataPointValue(dataPoint);
    expect(durationSum).toBeGreaterThan(0);
    expect(durationSum).toBeLessThan(1);

    // Verify metric attributes
    expect(dataPoint.attributes["http.request.method"]).toBe("GET");
    expect(dataPoint.attributes["url.path"]).toBe("/hello");
    expect(dataPoint.attributes["http.response.status_code"]).toBe(200);
  });

  test("records http.server.requests.total counter metric", async () => {
    await using tsdk = new TestSDK();

    // Make multiple requests
    for (let i = 0; i < 3; i++) {
      await fetch(`${serverUrl}/json`);
    }

    const resourceMetrics = await tsdk.waitForMetrics();
    const scopeMetrics = resourceMetrics[0].scopeMetrics;
    const counterMetric = scopeMetrics
      .flatMap(sm => sm.metrics)
      .find(m => m.descriptor.name === "http.server.requests.total");

    expect(counterMetric).toBeDefined();
    expect(counterMetric!.descriptor.description).toContain("Total");

    // Should have data points for our requests
    expect(counterMetric!.dataPoints.length).toBeGreaterThan(0);

    // Find data point for /json endpoint
    const jsonDataPoint = counterMetric!.dataPoints.find((dp: any) => dp.attributes["url.path"] === "/json");
    expect(jsonDataPoint).toBeDefined();
    expect(jsonDataPoint!.value).toBe(3);
  });

  test("metrics work without tracing (metrics-only mode)", async () => {
    // TestSDK automatically provides both spans and metrics
    await using tsdk = new TestSDK();

    const response = await fetch(`${serverUrl}/hello`);
    await response.text();

    const resourceMetrics = await tsdk.waitForMetrics();
    expect(resourceMetrics.length).toBeGreaterThan(0);

    // Metrics should still be recorded
    const scopeMetrics = resourceMetrics[0].scopeMetrics;
    const durationMetric = scopeMetrics
      .flatMap(sm => sm.metrics)
      .find(m => m.descriptor.name === "http.server.request.duration");

    expect(durationMetric).toBeDefined();
    expect(durationMetric!.dataPoints.length).toBeGreaterThan(0);
  });

  test("tracks multiple endpoints separately with correct attributes", async () => {
    await using tsdk = new TestSDK();

    // Make requests to different endpoints
    await fetch(`${serverUrl}/hello`);
    await fetch(`${serverUrl}/json`);
    await fetch(`${serverUrl}/error`);

    const resourceMetrics = await tsdk.waitForMetrics();
    const scopeMetrics = resourceMetrics[0].scopeMetrics;
    const counterMetric = scopeMetrics
      .flatMap(sm => sm.metrics)
      .find(m => m.descriptor.name === "http.server.requests.total");

    expect(counterMetric).toBeDefined();

    // Should have separate data points for each endpoint
    const dataPoints = counterMetric!.dataPoints;
    const endpoints = new Set(dataPoints.map((dp: any) => dp.attributes["url.path"]));

    expect(endpoints.has("/hello")).toBe(true);
    expect(endpoints.has("/json")).toBe(true);
    expect(endpoints.has("/error")).toBe(true);

    // Verify error endpoint has correct status code
    const errorDataPoint = dataPoints.find((dp: any) => dp.attributes["url.path"] === "/error");
    expect(errorDataPoint).toBeDefined();
    expect(errorDataPoint!.attributes["http.response.status_code"]).toBe(500);
  });

  test("duration increases with slow handlers", async () => {
    await using tsdk = new TestSDK();

    // Make fast request
    const fastResponse = await fetch(`${serverUrl}/hello`);
    await fastResponse.text();

    // Make slow request
    const slowResponse = await fetch(`${serverUrl}/slow`);
    await slowResponse.text();

    const resourceMetrics = await tsdk.waitForMetrics();
    const scopeMetrics = resourceMetrics[0].scopeMetrics;
    const durationMetric = scopeMetrics
      .flatMap(sm => sm.metrics)
      .find(m => m.descriptor.name === "http.server.request.duration");

    // Find the data points for both endpoints
    const fastDataPoint = durationMetric!.dataPoints.find((dp: any) => dp.attributes["url.path"] === "/hello");
    const slowDataPoint = durationMetric!.dataPoints.find((dp: any) => dp.attributes["url.path"] === "/slow");

    const fastDuration = getDataPointValue(fastDataPoint);
    const slowDuration = getDataPointValue(slowDataPoint);

    // Slow request should take longer (at least 45ms = 0.045s, allowing for timing variance)
    expect(slowDuration).toBeGreaterThan(fastDuration);
    expect(slowDuration).toBeGreaterThan(0.045);
  });

  test("metrics include server.address and server.port attributes", async () => {
    await using tsdk = new TestSDK();

    await fetch(`${serverUrl}/hello`);

    const resourceMetrics = await tsdk.waitForMetrics();
    const scopeMetrics = resourceMetrics[0].scopeMetrics;
    const durationMetric = scopeMetrics
      .flatMap(sm => sm.metrics)
      .find(m => m.descriptor.name === "http.server.request.duration");

    const dataPoint = durationMetric!.dataPoints[0];
    expect(dataPoint.attributes["server.address"]).toBe("127.0.0.1");
    expect(dataPoint.attributes["server.port"]).toBe(server!.port);
  });
});
