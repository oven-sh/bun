import { propagation } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { expect, test, describe } from "bun:test";
import { BunSDK, createTelemetryBridge } from "./index";

// Set up W3C propagator globally for trace context tests
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

describe("BunSDK (new API)", () => {
  test("creates spans for HTTP requests", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

    const sdk = new BunSDK({
      tracerProvider: provider,
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
    const provider = new NodeTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

    const sdk = new BunSDK({
      tracerProvider: provider,
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

describe("createTelemetryBridge (legacy API)", () => {

test("creates spans for HTTP requests", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

  const bridge = createTelemetryBridge({
    tracerProvider: provider,
  });

  const server = Bun.serve({
    port: 0, // Random port
    fetch() {
      return new Response("test");
    },
  });

  try {
    const response = await fetch(`http://localhost:${server.port}/`);
    expect(response.status).toBe(200);

    // Wait for span to be exported
    await new Promise(resolve => setTimeout(resolve, 100));

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("GET /");
    expect(spans[0].attributes["http.method"]).toBe("GET");
    expect(spans[0].attributes["http.status_code"]).toBe(200);
  } finally {
    server.stop();
    bridge.disable();
  }
});

test("propagates trace context", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

  const bridge = createTelemetryBridge({
    tracerProvider: provider,
  });

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
    bridge.disable();
  }
});

  test("records errors", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

    const bridge = createTelemetryBridge({
      tracerProvider: provider,
    });

    // Use a Response.error() which is more controlled than throwing
    const server = Bun.serve({
      port: 0,
      async fetch() {
        // Simulate an error by returning a 500 status
        return new Response("Internal Server Error", { status: 500 });
      },
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/`);
      expect(response.status).toBe(500);

      await new Promise(resolve => setTimeout(resolve, 100));

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBeGreaterThan(0);

      const span = spans[0];
      // Verify span was created with proper status code
      expect(span.attributes["http.status_code"]).toBe(500);
    } finally {
      server.stop();
      bridge.disable();
    }
  });
});
