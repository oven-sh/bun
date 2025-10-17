// Example: Using bun-otel with Hono framework
import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { createTelemetryBridge } from "bun-otel";
import { Hono } from "hono";

// Setup OpenTelemetry
const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
});

sdk.start();
createTelemetryBridge({ tracerProvider: sdk.getTracerProvider() });

// Create Hono app
const app = new Hono();

app.get("/users/:id", async c => {
  const id = c.req.param("id");

  // Add custom attributes to the active span
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttribute("user.id", id);
    span.setAttribute("route", "/users/:id");
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
