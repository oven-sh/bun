import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "bun:test";
import { BunSDK } from "../index";
import { waitForSpans } from "./test-utils";
import { resourceFromAttributes } from "@opentelemetry/resources";

describe("BunSDK resource configuration", () => {
  test("sets service name in resource", async () => {
    const exporter = new InMemorySpanExporter();
    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      serviceName: "test-service",
    });

    sdk.start();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    await fetch(`http://localhost:${server.port}/`);
    await waitForSpans(exporter, 2);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);

    const resource = spans[0].resource;
    expect(resource.attributes["service.name"]).toBe("test-service");
  });

  test("merges custom resources with auto-detected resources", async () => {
    const exporter = new InMemorySpanExporter();

    // Import Resource here to avoid linter issues
    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      resource: resourceFromAttributes({
        "deployment.environment": "production",
        "service.version": "1.0.0",
      }),
      serviceName: "my-service",
      autoDetectResources: true,
    });

    sdk.start();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    await fetch(`http://localhost:${server.port}/`);
    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);

    const resource = spans[0].resource;
    // Check custom attributes
    expect(resource.attributes["deployment.environment"]).toBe("production");
    expect(resource.attributes["service.version"]).toBe("1.0.0");
    expect(resource.attributes["service.name"]).toBe("my-service");

    // Check auto-detected attributes exist (at least some of them)
    expect(resource.attributes["process.pid"]).toBeDefined();
  });

  test("can disable auto-detect resources", async () => {
    const exporter = new InMemorySpanExporter();

    await using sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
      resource: resourceFromAttributes({
        "custom.attribute": "value",
      }),
      autoDetectResources: false,
    });

    sdk.start();

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    await fetch(`http://localhost:${server.port}/`);
    await waitForSpans(exporter, 1);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);

    const resource = spans[0].resource;
    expect(resource.attributes["custom.attribute"]).toBe("value");
    // Should not have auto-detected process attributes
    expect(resource.attributes["process.pid"]).toBeUndefined();
  });
});
