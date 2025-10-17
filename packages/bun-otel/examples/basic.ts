// Example: Basic usage with Bun.serve and OpenTelemetry
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { createTelemetryBridge } from "bun-otel";

// Initialize OpenTelemetry
const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
});

sdk.start();

// Bridge Bun telemetry to OpenTelemetry
createTelemetryBridge({
  tracerProvider: sdk.getTracerProvider(),
});

// Now all Bun.serve requests are automatically traced!
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Hello World");
  },
});

console.log("Server running at http://localhost:3000");
console.log("All requests are automatically traced!");
