// Example: Using bun-otel with Elysia framework
import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { createTelemetryBridge } from "bun-otel";
import { Elysia } from "elysia";

// Setup OpenTelemetry
const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
});

sdk.start();
createTelemetryBridge({ tracerProvider: sdk.getTracerProvider() });

// Create Elysia app
const app = new Elysia()
  .onRequest(ctx => {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute("route", ctx.path);
    }
  })
  .get("/users/:id", async ({ params }) => {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute("user.id", params.id);
    }

    // Simulate database query
    await Bun.sleep(100);

    return { id: params.id, name: "John Doe" };
  });

// Start server
Bun.serve({
  port: 3000,
  fetch: app.fetch,
});

console.log("Elysia server with automatic tracing at http://localhost:3000");
