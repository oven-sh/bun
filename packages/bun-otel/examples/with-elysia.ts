// Example: Using bun-otel with Elysia framework
import { trace } from "@opentelemetry/api";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { BunSDK } from "bun-otel";
import { Elysia } from "elysia";

// Setup OpenTelemetry with service name
const sdk = new BunSDK({
  traceExporter: new ConsoleSpanExporter(),
  serviceName: "elysia-api",
});
sdk.start();

// Create Elysia app
const app = new Elysia()
  .onRequest(ctx => {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute("http.route", ctx.path);
    }
  })
  .get("/users/:id", async ({ params }) => {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute("enduser.id", params.id);
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

// Graceful shutdown to flush spans
process.on("SIGINT", async () => {
  await sdk.shutdown();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await sdk.shutdown();
  process.exit(0);
});
