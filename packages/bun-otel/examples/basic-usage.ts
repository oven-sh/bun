/**
 * Example: Basic usage of BunFetchInstrumentation and BunHttpInstrumentation
 *
 * This example shows how to set up OpenTelemetry instrumentation for Bun's
 * native HTTP server and fetch client using the standard OTel SDK.
 */

import { BasicTracerProvider, ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BunFetchInstrumentation, BunHttpInstrumentation } from "bun-otel";

// 1. Create a TracerProvider with ConsoleSpanExporter (for demo purposes)
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));

// 2. Create and configure BunHttpInstrumentation for Bun.serve()
const httpInstrumentation = new BunHttpInstrumentation({
  captureAttributes: {
    requestHeaders: ["user-agent", "content-type", "x-request-id"],
    responseHeaders: ["content-type", "x-trace-id"],
  },
});

httpInstrumentation.setTracerProvider(provider);
httpInstrumentation.enable();

// 3. Create and configure BunFetchInstrumentation for fetch()
const fetchInstrumentation = new BunFetchInstrumentation({
  captureAttributes: {
    requestHeaders: ["content-type"],
    responseHeaders: ["content-type", "cache-control"],
  },
});

fetchInstrumentation.setTracerProvider(provider);
fetchInstrumentation.enable();

console.log("✓ OpenTelemetry instrumentations enabled");

// 4. Start a Bun.serve() server - requests will be automatically traced
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/users") {
      // Make an outbound fetch request - will be traced as CLIENT span
      const response = await fetch("https://jsonplaceholder.typicode.com/users/1");
      const data = await response.json();

      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Hello from Bun!", {
      headers: { "content-type": "text/plain" },
    });
  },
});

console.log("Server listening on http://localhost:3000");
console.log("Try: curl http://localhost:3000/api/users");
console.log("\nSpans will be printed to console (using ConsoleSpanExporter)");
