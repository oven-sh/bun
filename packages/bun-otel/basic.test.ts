import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "bun:test";
import { BunSDK } from "./index";

describe("BunSDK basic functionality", () => {
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
});
