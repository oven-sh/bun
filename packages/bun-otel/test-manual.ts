// Manual test for bun-otel with Bun's telemetry API
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { createTelemetryBridge } from "./index";

console.log("Testing bun-otel package...\n");

// Setup OpenTelemetry with in-memory exporter for testing
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

// Create the telemetry bridge
console.log("✓ Creating telemetry bridge");
const bridge = createTelemetryBridge({
  tracerProvider: provider,
});

// Create a simple server
const server = Bun.serve({
  port: 0,
  fetch(req) {
    return new Response("Hello from Bun!");
  },
});

console.log(`✓ Server started on port ${server.port}`);

// Make a test request
console.log("✓ Making test request...");
const response = await fetch(`http://localhost:${server.port}/test`);
console.log(`✓ Got response: ${response.status}`);

// Wait a bit for span to be exported
await Bun.sleep(200);

// Check spans
const spans = exporter.getFinishedSpans();
console.log(`\n✓ Found ${spans.length} span(s)`);

if (spans.length > 0) {
  const span = spans[0];
  console.log("\nSpan details:");
  console.log(`  Name: ${span.name}`);
  console.log(`  Status: ${span.status.code === 1 ? "OK" : "ERROR"}`);
  console.log(`  Attributes:`);
  for (const [key, value] of Object.entries(span.attributes)) {
    console.log(`    ${key}: ${value}`);
  }
} else {
  console.error("\n✗ No spans found! Telemetry may not be working.");
}

// Cleanup
server.stop();
bridge.disable();

console.log("\n✓ Test complete!");
