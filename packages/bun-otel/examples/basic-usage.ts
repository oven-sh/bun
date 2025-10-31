/**
 * Example: Basic usage of BunSDK for OpenTelemetry instrumentation
 *
 * This example shows the simplest way to set up OpenTelemetry in Bun applications
 * using BunSDK - a drop-in replacement for @opentelemetry/sdk-node.
 *
 * BunSDK automatically instruments:
 * - Bun.serve() HTTP server (creates SERVER spans)
 * - fetch() client (creates CLIENT spans)
 */

import { ConsoleSpanExporter, BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BunSDK } from "bun-otel";

// 1. Create and configure BunSDK using `using` for automatic cleanup
using sdk = new BunSDK({
  // Service name identifies your application in distributed traces
  serviceName: "bun-example-service",

  // Optional: Customize instrumentation behavior
  // Uncomment to capture additional headers:
  // http: {
  //   captureAttributes: {
  //     requestHeaders: ["user-agent", "content-type", "x-request-id"],
  //     responseHeaders: ["content-type", "x-trace-id"],
  //   },
  // },
  // fetch: {
  //   captureAttributes: {
  //     requestHeaders: ["content-type"],
  //     responseHeaders: ["content-type", "cache-control"],
  //   },
  // },

  // Exporter for sending traces (ConsoleSpanExporter prints to console)
  tracerProvider: new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
  }),
});

// 2. Start the SDK and register graceful shutdown handlers
// Handles SIGINT/SIGTERM and ensures telemetry is flushed before exit
await sdk.startAndRegisterSystemShutdownHooks();

console.log("✓ BunSDK initialized - OpenTelemetry active");

// 3. Start a Bun.serve() server - requests are automatically traced!
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/users") {
      // Make an outbound fetch request - automatically traced as CLIENT span
      // Parent-child relationship is maintained automatically
      const response = await fetch("https://jsonplaceholder.typicode.com/users/1");
      const data = await response.json();

      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Hello from Bun with OpenTelemetry!", {
      headers: { "content-type": "text/plain" },
    });
  },
});

console.log("\nServer listening on http://localhost:3000");
console.log("Try: curl http://localhost:3000/api/users");
console.log("\nSpans will be printed to console:");
console.log("  - SERVER span for incoming HTTP request");
console.log("  - CLIENT span for outbound fetch request");
console.log("\nPress Ctrl+C for graceful shutdown");

/**
 * Alternative patterns:
 *
 * 1. With custom cleanup callback:
 *    using sdk = new BunSDK({ ... });
 *    await sdk.startAndRegisterSystemShutdownHooks(async () => {
 *      console.log("Closing database...");
 *      await db.close();
 *    });
 *
 * 2. Manual start without shutdown hooks:
 *    using sdk = new BunSDK({ ... });
 *    sdk.start();
 *    // ... run your app ...
 *    // sdk.shutdown() called automatically when scope exits
 *
 * 3. Explicit shutdown (for tests):
 *    const sdk = new BunSDK({ ... });
 *    sdk.start();
 *    // ... run your app ...
 *    await sdk.shutdown();
 */
