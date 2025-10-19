// Example: Basic usage with Bun.serve and OpenTelemetry
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { BunSDK } from "bun-otel";

// Initialize OpenTelemetry with service name
const sdk = new BunSDK({
  traceExporter: new ConsoleSpanExporter(),
  serviceName: "my-bun-service",
});
sdk.start();

// Now all Bun.serve requests are automatically traced!
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Hello World");
  },
});

console.log("Server running at http://localhost:3000");
console.log("All requests are automatically traced!");

// Graceful shutdown
const shutdown = async () => {
  await sdk.shutdown();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
