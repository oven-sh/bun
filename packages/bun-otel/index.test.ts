import { propagation } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "bun:test";
import { BunSDK } from "./index";

// Set up W3C propagator globally for trace context tests
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

describe("BunSDK (new API)", () => {
  test("creates spans for HTTP requests", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/`);
      expect(response.status).toBe(200);

      await new Promise(resolve => setTimeout(resolve, 100));

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("GET /");
      expect(spans[0].attributes["http.method"]).toBe("GET");
      expect(spans[0].attributes["http.status_code"]).toBe(200);
    } finally {
      server.stop();
      sdk.shutdown();
    }
  });

  test("propagates trace context", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    try {
      await fetch(`http://localhost:${server.port}/`, {
        headers: {
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const spans = exporter.getFinishedSpans();
      const spanContext = spans[0].spanContext();
      expect(spanContext.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    } finally {
      server.stop();
      sdk.shutdown();
    }
  });
});

describe("BunSDK with Node.js http.createServer (IncomingMessage)", () => {
  test("creates spans for Node.js http server requests", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Node.js server");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => resolve());
      server.on("error", reject);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server address not available");
    }

    const port = address.port;

    try {
      const response = await fetch(`http://localhost:${port}/test`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("Node.js server");

      await new Promise(resolve => setTimeout(resolve, 100));

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("GET /test");
      expect(spans[0].attributes["http.method"]).toBe("GET");
      expect(spans[0].attributes["http.target"]).toBe("/test");
      expect(spans[0].attributes["http.status_code"]).toBe(200);
    } finally {
      await new Promise<void>(resolve => {
        server.close(() => resolve());
      });
      sdk.shutdown();
    }
  });

  test("propagates trace context from Node.js http server", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("OK");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => resolve());
      server.on("error", reject);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server address not available");
    }

    const port = address.port;

    try {
      await fetch(`http://localhost:${port}/`, {
        headers: {
          traceparent: "00-abcdef1234567890abcdef1234567890-1234567890abcdef-01",
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);

      const spanContext = spans[0].spanContext();
      expect(spanContext.traceId).toBe("abcdef1234567890abcdef1234567890");
    } finally {
      await new Promise<void>(resolve => {
        server.close(() => resolve());
      });
      sdk.shutdown();
    }
  });

  test("extracts headers from IncomingMessage correctly", async () => {
    const exporter = new InMemorySpanExporter();

    const sdk = new BunSDK({
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    sdk.start();

    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("OK");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => resolve());
      server.on("error", reject);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server address not available");
    }

    const port = address.port;

    try {
      await fetch(`http://localhost:${port}/api/users/123`, {
        headers: {
          "User-Agent": "TestAgent/1.0",
          "Content-Length": "42",
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);

      const span = spans[0];
      expect(span.attributes["http.user_agent"]).toBe("TestAgent/1.0");
      // Content-Length may not be set for GET requests, but we're testing header extraction
      expect(span.attributes["http.target"]).toBe("/api/users/123");
      expect(span.attributes["http.host"]).toContain("localhost");
    } finally {
      await new Promise<void>(resolve => {
        server.close(() => resolve());
      });
      sdk.shutdown();
    }
  });
});

describe("BunSDK Configuration", () => {
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
