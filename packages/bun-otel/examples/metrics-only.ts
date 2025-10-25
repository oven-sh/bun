/**
 * Example: Metrics-only mode with BunSDK
 *
 * This example demonstrates how to use BunSDK in metrics-only mode
 * (no tracing/spans). This is useful when you only want to collect
 * performance metrics without the overhead of distributed tracing.
 *
 * Per Node.js SDK compatibility: TracerProvider is optional!
 */

import { ConsoleMetricExporter, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BunSDK } from "bun-otel";

// 1. Create BunSDK with ONLY metrics configured (no traceExporter)
using sdk = new BunSDK({
  // Service name for resource attributes
  serviceName: "bun-metrics-example",

  // Configure metrics collection with periodic export
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter(),
      exportIntervalMillis: 5000, // Export metrics every 5 seconds
    }),
  ],

  // Note: No traceExporter configured!
  // TracerProvider will NOT be created, but instrumentations
  // will still collect metrics using global MeterProvider
});

// 2. Start the SDK - only MeterProvider will be registered
await sdk.startAndRegisterSystemShutdownHooks();

console.log("✓ BunSDK initialized in METRICS-ONLY mode");
console.log("  - MeterProvider: ACTIVE");
console.log("  - TracerProvider: NOT CREATED (metrics-only mode)");

// 3. Start HTTP server - metrics will be collected!
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));

    if (url.pathname === "/api/slow") {
      // Simulate slow endpoint
      await new Promise(resolve => setTimeout(resolve, 500));
      return new Response("Slow response", { status: 200 });
    }

    if (url.pathname === "/api/error") {
      // Simulate error
      return new Response("Server error", { status: 500 });
    }

    return new Response("OK", { status: 200 });
  },
});

console.log("\nServer listening on http://localhost:3000");
console.log("\nGenerate some traffic to see metrics:");
console.log("  curl http://localhost:3000/");
console.log("  curl http://localhost:3000/api/slow");
console.log("  curl http://localhost:3000/api/error");
console.log("\nMetrics collected:");
console.log("  - http.server.duration (ms) - OLD semconv");
console.log("  - http.server.request.duration (s) - STABLE semconv");
console.log("  - http.server.requests.total - Request counter");
console.log("\nMetrics exported to console every 5 seconds...");
console.log("Press Ctrl+C for graceful shutdown");

/**
 * Expected output (after some requests):
 *
 * {
 *   descriptor: {
 *     name: 'http.server.duration',
 *     type: 'HISTOGRAM',
 *     unit: 'ms',
 *     description: 'Measures the duration of inbound HTTP requests.'
 *   },
 *   dataPoints: [
 *     {
 *       attributes: {
 *         'http.request.method': 'GET',
 *         'url.path': '/',
 *         'http.response.status_code': 200,
 *         'server.address': '0.0.0.0',
 *         'server.port': 3000
 *       },
 *       value: {
 *         count: 10,
 *         sum: 125.3,
 *         min: 5.2,
 *         max: 25.1
 *       }
 *     }
 *   ]
 * }
 */
