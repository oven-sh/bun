// Example: Advanced usage with custom resources and auto-detection
import { Resource } from "@opentelemetry/resources";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { BunSDK } from "bun-otel";

// Initialize OpenTelemetry with custom resources and auto-detection
const sdk = new BunSDK({
  traceExporter: new ConsoleSpanExporter(),
  serviceName: "my-production-service",
  // Custom resource attributes
  resource: new Resource({
    "deployment.environment": "production",
    "service.version": "1.2.3",
    "service.namespace": "my-company",
  }),
  // Auto-detect host, process, and environment resources
  autoDetectResources: true,
});
sdk.start();

// Now all Bun.serve requests include rich resource context!
const server = Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Hello World with rich telemetry context!");
  },
});

console.log("Server running at http://localhost:3000");
console.log("Traces include:");
console.log("- Service name: my-production-service");
console.log("- Custom attributes: deployment.environment, service.version, service.namespace");
console.log("- Auto-detected: host info, process info, environment variables");

// Graceful, idempotent shutdown
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    server.stop();
    await sdk.shutdown();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
