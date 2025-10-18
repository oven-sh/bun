import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "bun:test";
import { BunSDK } from "./index";

describe("BunSDK resource configuration", () => {
  test("sets service name in resource", async () => {
    const exporter = new InMemorySpanExporter();
    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "test-service",
    });

    sdk.start();

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    try {
      await fetch(`http://localhost:${server.port}/`);
      await new Promise(resolve => setTimeout(resolve, 100));

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);

      const resource = spans[0].resource;
      expect(resource.attributes["service.name"]).toBe("test-service");
    } finally {
      server.stop();
      await sdk.shutdown();
    }
  });

  test("merges custom resources with auto-detected resources", async () => {
    const exporter = new InMemorySpanExporter();

    // Import Resource here to avoid linter issues
    const { Resource } = await import("@opentelemetry/resources");

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      resource: new Resource({
        "deployment.environment": "production",
        "service.version": "1.0.0",
      }),
      serviceName: "my-service",
      autoDetectResources: true,
    });

    sdk.start();

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    try {
      await fetch(`http://localhost:${server.port}/`);
      await new Promise(resolve => setTimeout(resolve, 100));

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);

      const resource = spans[0].resource;
      // Check custom attributes
      expect(resource.attributes["deployment.environment"]).toBe("production");
      expect(resource.attributes["service.version"]).toBe("1.0.0");
      expect(resource.attributes["service.name"]).toBe("my-service");

      // Check auto-detected attributes exist (at least some of them)
      expect(resource.attributes["process.pid"]).toBeDefined();
    } finally {
      server.stop();
      await sdk.shutdown();
    }
  });

  test("can disable auto-detect resources", async () => {
    const exporter = new InMemorySpanExporter();

    const { Resource } = await import("@opentelemetry/resources");

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      resource: new Resource({
        "custom.attribute": "value",
      }),
      autoDetectResources: false,
    });

    sdk.start();

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    try {
      await fetch(`http://localhost:${server.port}/`);
      await new Promise(resolve => setTimeout(resolve, 100));

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);

      const resource = spans[0].resource;
      expect(resource.attributes["custom.attribute"]).toBe("value");
      // Should not have auto-detected process attributes
      expect(resource.attributes["process.pid"]).toBeUndefined();
    } finally {
      server.stop();
      await sdk.shutdown();
    }
  });
});
