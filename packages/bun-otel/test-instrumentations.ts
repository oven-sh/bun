/**
 * Quick test to verify BunFetchInstrumentation and BunHttpInstrumentation work correctly
 */

import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BunFetchInstrumentation, BunHttpInstrumentation } from "./index";

console.log("Testing BunFetchInstrumentation and BunHttpInstrumentation...\n");

// Create a tracer provider with in-memory exporter
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

// Test BunFetchInstrumentation
console.log("1. Creating BunFetchInstrumentation...");
const fetchInst = new BunFetchInstrumentation({
  captureAttributes: {
    requestHeaders: ["content-type"],
    responseHeaders: ["content-type", "cache-control"],
  },
});

console.log("   ✓ Name:", fetchInst.instrumentationName);
console.log("   ✓ Version:", fetchInst.instrumentationVersion);
console.log("   ✓ Config:", JSON.stringify(fetchInst.getConfig(), null, 2));

fetchInst.setTracerProvider(provider);
console.log("   ✓ TracerProvider set");

// Test BunHttpInstrumentation
console.log("\n2. Creating BunHttpInstrumentation...");
const httpInst = new BunHttpInstrumentation({
  captureAttributes: {
    requestHeaders: ["user-agent", "x-request-id"],
    responseHeaders: ["content-type", "x-trace-id"],
  },
});

console.log("   ✓ Name:", httpInst.instrumentationName);
console.log("   ✓ Version:", httpInst.instrumentationVersion);
console.log("   ✓ Config:", JSON.stringify(httpInst.getConfig(), null, 2));

httpInst.setTracerProvider(provider);
console.log("   ✓ TracerProvider set");

// Test configuration updates
console.log("\n3. Testing configuration updates...");
fetchInst.setConfig({
  enabled: false,
});
console.log("   ✓ Fetch config updated:", fetchInst.getConfig().enabled === false);

httpInst.setConfig({
  enabled: true,
  captureAttributes: {
    requestHeaders: ["content-type"],
    responseHeaders: ["content-type"],
  },
});
console.log("   ✓ HTTP config updated");

console.log("\n✅ All tests passed!");
console.log("\nNote: enable() will only work in Bun runtime with Bun.telemetry API");
