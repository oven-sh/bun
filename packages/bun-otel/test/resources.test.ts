import { describe, expect, test } from "bun:test";
import { TestSDK } from "./test-utils";
import { resourceFromAttributes } from "@opentelemetry/resources";

describe("BunSDK resource configuration", () => {
  test("sets service name in resource", async () => {
    await using sdk = await TestSDK.start({
      serviceName: "test-service",
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    await fetch(`http://localhost:${server.port}/`);
    const spans = await sdk.waitForSpans(2);

    const resource = spans[0].resource;
    expect(resource.attributes["service.name"]).toBe("test-service");
  });

  test("merges custom resources with auto-detected resources", async () => {
    await using sdk = await TestSDK.start({
      resource: resourceFromAttributes({
        "deployment.environment": "production",
        "service.version": "1.0.0",
      }),
      serviceName: "my-service",
      autoDetectResources: true,
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    await fetch(`http://localhost:${server.port}/`);
    const spans = await sdk.waitForSpans(1, s => s.server());

    const resource = spans[0].resource;
    // Check custom attributes
    expect(resource.attributes["deployment.environment"]).toBe("production");
    expect(resource.attributes["service.version"]).toBe("1.0.0");
    expect(resource.attributes["service.name"]).toBe("my-service");

    // Check auto-detected attributes exist (at least some of them)
    expect(resource.attributes["process.pid"]).toBeDefined();
  });

  test("can disable auto-detect resources", async () => {
    await using sdk = await TestSDK.start({
      resource: resourceFromAttributes({
        "custom.attribute": "value",
      }),
      autoDetectResources: false,
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    await fetch(`http://localhost:${server.port}/`);
    const spans = await sdk.waitForSpans(1, s => s.server());

    const resource = spans[0].resource;
    expect(resource.attributes["custom.attribute"]).toBe("value");
    // Should not have auto-detected process attributes
    expect(resource.attributes["process.pid"]).toBeUndefined();
  });
});
