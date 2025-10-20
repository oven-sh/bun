import { context } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createBunTelemetryConfig } from "./otel-core";

// Test helpers to reduce duplication
interface TestTelemetryContext {
  tracerProvider: NodeTracerProvider;
  meterProvider: MeterProvider;
  metricExporter: InMemoryMetricExporter;
  metricsInstrumentation?: unknown;
  flush: () => Promise<void>;
  getResourceMetrics: () => ReturnType<InMemoryMetricExporter["getMetrics"]>;
  findMetric: (name: string) => any;
}

function createTestTelemetry(): TestTelemetryContext {
  // Some versions of the OTEL SDK require an explicit AggregationTemporality
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE as any);
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 100,
  });

  const meterProvider = new MeterProvider({ readers: [metricReader] });
  const tracerProvider = new NodeTracerProvider();

  const { config, metricsInstrumentation } = createBunTelemetryConfig({
    tracerProvider,
    meterProvider,
  });

  Bun.telemetry.configure(config);

  async function flush() {
    await meterProvider.forceFlush();
  }

  function getResourceMetrics() {
    return metricExporter.getMetrics();
  }

  function findMetric(name: string) {
    const resourceMetrics = metricExporter.getMetrics();
    for (const rm of resourceMetrics) {
      for (const sm of rm.scopeMetrics) {
        const match = sm.metrics.find(m => m.descriptor.name === name);
        if (match) return match;
      }
    }
    return undefined;
  }

  return {
    tracerProvider,
    meterProvider,
    metricExporter,
    metricsInstrumentation,
    flush,
    getResourceMetrics,
    findMetric,
  };
}

// Helper to normalize histogram/counter data point values across OTEL versions
function getDataPointSum(dp: any): number {
  if (!dp) return 0;
  const v: any = dp.value;
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "sum" in v) return v.sum as number;
  return 0;
}

describe("HTTP Server Metrics", () => {
  let ctx: TestTelemetryContext;
  // Track providers created during tests for cleanup
  const providers: { shutdown: () => Promise<void> }[] = [];

  beforeEach(() => {
    ctx = createTestTelemetry();
    providers.push(ctx.tracerProvider);
    providers.push(ctx.meterProvider);
  });

  afterEach(async () => {
    Bun.telemetry.disable();

    // Shutdown all providers created during tests
    await Promise.all(providers.map(p => p.shutdown()));
    providers.length = 0;

    // Clear global context manager to prevent test isolation issues
    context.disable();
  });

  test("records http.server.request.duration metric", async () => {
    expect(ctx.metricsInstrumentation).toBeDefined();

    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("Hello, metrics!"),
    });

    const response = await fetch(`http://localhost:${server.port}/test`);
    expect((response as any).status).toBe(200);
    await (response as any).text();

    await ctx.flush();
    const resourceMetrics = ctx.getResourceMetrics();
    expect(resourceMetrics.length).toBeGreaterThan(0);

    const scopeMetrics = resourceMetrics[0].scopeMetrics[0];
    const durationMetric = scopeMetrics.metrics.find(m => m.descriptor.name === "http.server.request.duration");

    expect(durationMetric).toBeDefined();
    expect(durationMetric!.descriptor.description).toBe("Duration of HTTP server requests");
    expect(durationMetric!.descriptor.unit).toBe("s");

    expect(durationMetric!.dataPoints.length).toBe(1);
    const dataPoint = durationMetric!.dataPoints[0];
    const durationSum = getDataPointSum(dataPoint);
    expect(durationSum).toBeGreaterThan(0);
    expect(durationSum).toBeLessThan(1);
  });

  test("records http.server.requests.total counter", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("OK"),
    });

    for (let i = 0; i < 3; i++) {
      await fetch(`http://localhost:${server.port}/test`);
    }

    await ctx.flush();
    const resourceMetrics = ctx.getResourceMetrics();
    const scopeMetrics = resourceMetrics[0].scopeMetrics[0];
    const counterMetric = scopeMetrics.metrics.find(m => m.descriptor.name === "http.server.requests.total");

    expect(counterMetric).toBeDefined();
    expect(counterMetric!.descriptor.description).toBe("Total number of HTTP server requests");
    expect(counterMetric!.dataPoints.length).toBe(1);
    expect(counterMetric!.dataPoints[0].value).toBe(3);
  });

  test("metrics work without tracing enabled", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("Metrics only!"),
    });

    await fetch(`http://localhost:${server.port}/`);

    await ctx.flush();
    const resourceMetrics = ctx.getResourceMetrics();
    const scopeMetrics = resourceMetrics[0].scopeMetrics[0];
    const durationMetric = scopeMetrics.metrics.find(m => m.descriptor.name === "http.server.request.duration");
    const counterMetric = scopeMetrics.metrics.find(m => m.descriptor.name === "http.server.requests.total");

    expect(durationMetric).toBeDefined();
    expect(counterMetric).toBeDefined();
  });

  test("captures minimal attributes when request/response not available", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("OK", { status: 200 }),
    });

    await fetch(`http://localhost:${server.port}/api/test`);

    await ctx.flush();
    const durationMetric = ctx.findMetric("http.server.request.duration");

    expect(durationMetric).toBeDefined();
    const dataPoint = durationMetric!.dataPoints[0];
    const sum = getDataPointSum(dataPoint);
    expect(sum).toBeGreaterThan(0);
  });

  test("multiple requests with different endpoints", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: req => {
        const url = new URL((req as any).url);
        if (url.pathname === "/api/users") {
          return new Response("Users", { status: 200 });
        } else if (url.pathname === "/api/posts") {
          return new Response("Posts", { status: 200 });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    await fetch(`http://localhost:${server.port}/api/users`);
    await fetch(`http://localhost:${server.port}/api/posts`);
    await fetch(`http://localhost:${server.port}/api/unknown`);

    await ctx.flush();
    const resourceMetrics = ctx.getResourceMetrics();
    const scopeMetrics = resourceMetrics[0].scopeMetrics[0];
    const counterMetric = scopeMetrics.metrics.find(m => m.descriptor.name === "http.server.requests.total");

    expect(counterMetric).toBeDefined();

    // For now, just verify total count across datapoints
    expect(counterMetric!.dataPoints.length).toBeGreaterThan(0);

    let totalRequests = 0;
    for (const dp of counterMetric!.dataPoints) {
      totalRequests += dp.value as number;
    }
    expect(totalRequests).toBe(3);
  });

  test("duration increases with slow handlers", async () => {
    const DELAY_MS = 100;
    using server = Bun.serve({
      port: 0,
      fetch: async () => {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        return new Response("Slow response");
      },
    });

    await fetch(`http://localhost:${server.port}/slow`);

    await ctx.flush();
    const durationMetric = ctx.findMetric("http.server.request.duration");

    expect(durationMetric).toBeDefined();
    const dataPoint = durationMetric!.dataPoints[0];
    const durationSeconds = getDataPointSum(dataPoint);
    expect(durationSeconds).toBeGreaterThanOrEqual(DELAY_MS / 1000);
  });
});
