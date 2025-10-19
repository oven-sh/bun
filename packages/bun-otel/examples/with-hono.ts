// Example: Using bun-otel with Hono framework
import { trace } from "@opentelemetry/api";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { BunSDK } from "bun-otel";
import { Hono } from "hono";

// Setup OpenTelemetry with service name
const sdk = new BunSDK({
  traceExporter: new ConsoleSpanExporter(),
  serviceName: "hono-api",
});
sdk.start();

// Create Hono app
const app = new Hono();

app.get("/users/:id", async c => {
  const id = c.req.param("id");

  // Add custom attributes to the active span
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttribute("enduser.id", id);
    span.setAttribute("http.route", "/users/:id");
  }

  // Simulate database query
  await Bun.sleep(100);

  return c.json({ id, name: "John Doe" });
});

Bun.serve({
  port: 3000,
  fetch: app.fetch,
});

console.log("Hono server with automatic tracing at http://localhost:3000");

// Graceful shutdown to flush spans
process.on("SIGINT", async () => {
  await sdk.shutdown();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await sdk.shutdown();
  process.exit(0);
});
