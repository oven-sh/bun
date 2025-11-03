/**
 * Tests for config mappers - pure functions, no OTel complexity!
 */

import { SpanKind } from "@opentelemetry/api";
import { describe, expect, test } from "bun:test";
import {
  mapFetchClientConfig,
  mapHttpServerConfig,
  mapNodeHttpServerConfig,
  mapNodeSDKConfig,
} from "../src/config-mappers";

describe("mapHttpServerConfig", () => {
  test("uses defaults when no config provided", () => {
    const config = mapHttpServerConfig();

    expect(config.name).toBe("http.server");
    expect(config.kind).toBe("http");
    expect(config.enabled).toBe(true);
    expect(config.setsAsyncStorageContext).toBe(true);

    // Should have default headers
    expect(config.trace?.start).toContain("http.request.header.content-type");
    expect(config.trace?.start).toContain("http.request.header.user-agent");
    expect(config.trace?.update).toContain("http.response.header.content-type");
  });

  test("uses custom headers when provided (no defaults)", () => {
    const config = mapHttpServerConfig({
      captureAttributes: {
        requestHeaders: ["x-custom-header"],
      },
    });

    // Should have custom header
    expect(config.trace?.start).toContain("http.request.header.x-custom-header");

    // Should NOT have defaults (user wants only custom headers)
    expect(config.trace?.start).not.toContain("http.request.header.content-type");
  });

  test("migrates old headersToSpanAttributes format", () => {
    expect(() =>
      mapHttpServerConfig({
        headersToSpanAttributes: {
          server: {
            requestHeaders: ["authorization"], // Would fail security validation
          },
        },
      }),
    ).toThrow();
    const config = mapHttpServerConfig({
      headersToSpanAttributes: {
        server: {
          requestHeaders: ["x-custom"], // Would fail security validation
        },
      },
    });
    // Should extract from nested server format
    expect(config.trace?.start).toContain("http.request.header.x-custom");
  });

  test("extractSpanName creates correct format", () => {
    const config = mapHttpServerConfig();

    const spanName = config.extractSpanName!({
      "http.request.method": "POST",
      "url.path": "/users/123",
    });

    expect(spanName).toBe("POST /users/123");
  });

  test("extractSpanName prefers route over path", () => {
    const config = mapHttpServerConfig();

    const spanName = config.extractSpanName!({
      "http.request.method": "GET",
      "url.path": "/users/123",
      "http.route": "/users/:id",
    });

    expect(spanName).toBe("GET /users/:id");
  });

  test("extractSpanKind returns SERVER", () => {
    const config = mapHttpServerConfig();
    expect(config.extractSpanKind!({})).toBe(SpanKind.SERVER);
  });

  test("isError returns true for 5xx", () => {
    const config = mapHttpServerConfig();

    expect(config.isError!({ "http.response.status_code": 500 })).toBe(true);
    expect(config.isError!({ "http.response.status_code": 503 })).toBe(true);
  });

  test("isError returns false for 4xx", () => {
    const config = mapHttpServerConfig();

    expect(config.isError!({ "http.response.status_code": 400 })).toBe(false);
    expect(config.isError!({ "http.response.status_code": 404 })).toBe(false);
  });

  test("isError returns false for 2xx", () => {
    const config = mapHttpServerConfig();

    expect(config.isError!({ "http.response.status_code": 200 })).toBe(false);
    expect(config.isError!({ "http.response.status_code": 201 })).toBe(false);
  });

  test("extractParentContext gets traceparent from headers", () => {
    const config = mapHttpServerConfig();

    const headers = config.extractInboundTraceContext!({
      "http.request.header.traceparent": "00-trace-span-01",
      "http.request.header.tracestate": "vendor=value",
    });

    expect(headers.traceparent).toBe("00-trace-span-01");
    expect(headers.tracestate).toBe("vendor=value");
    expect(headers.linkOnly).toBeUndefined();
  });

  test("nativeDuration is 'end' for http", () => {
    const config = mapHttpServerConfig();
    expect(config.nativeDuration).toBe("end");
  });
});

describe("mapFetchClientConfig", () => {
  test("uses defaults when no config provided", () => {
    const config = mapFetchClientConfig();

    expect(config.name).toBe("http.client");
    expect(config.kind).toBe("fetch");
    expect(config.setsAsyncStorageContext).toBe(false); // CLIENT!

    // Should have default headers
    expect(config.trace?.start).toContain("http.request.header.content-type");
    expect(config.trace?.end).toContain("http.response.header.content-type");
  });

  test("uses custom headers when provided (no defaults)", () => {
    const config = mapFetchClientConfig({
      captureAttributes: {
        requestHeaders: ["x-request-id"],
        responseHeaders: ["x-trace-id"],
      },
    });

    expect(config.trace?.start).toContain("http.request.header.x-request-id");
    expect(config.trace?.end).toContain("http.response.header.x-trace-id");

    // Should NOT have defaults (user wants only custom headers)
    expect(config.trace?.start).not.toContain("http.request.header.content-type");
  });

  test("extractSpanName returns just method", () => {
    const config = mapFetchClientConfig();

    const spanName = config.extractSpanName!({
      "http.request.method": "POST",
      "url.full": "https://api.example.com/users",
    });

    // Low cardinality for metrics
    expect(spanName).toBe("POST");
  });

  test("extractSpanKind returns CLIENT", () => {
    const config = mapFetchClientConfig();
    expect(config.extractSpanKind!({})).toBe(SpanKind.CLIENT);
  });

  test("isError returns true for 4xx and 5xx", () => {
    const config = mapFetchClientConfig();

    expect(config.isError!({ "http.response.status_code": 400 })).toBe(true);
    expect(config.isError!({ "http.response.status_code": 404 })).toBe(true);
    expect(config.isError!({ "http.response.status_code": 500 })).toBe(true);
  });

  test("isError returns false for 2xx and 3xx", () => {
    const config = mapFetchClientConfig();

    expect(config.isError!({ "http.response.status_code": 200 })).toBe(false);
    expect(config.isError!({ "http.response.status_code": 301 })).toBe(false);
  });

  test("nativeDuration is undefined for fetch", () => {
    const config = mapFetchClientConfig();
    expect(config.nativeDuration).toBeUndefined();
  });

  test("trace.start includes url.full not url.path", () => {
    const config = mapFetchClientConfig();

    expect(config.trace?.start).toContain("url.full");
    expect(config.trace?.start).not.toContain("url.path");
  });
});

describe("mapNodeHttpServerConfig", () => {
  test("uses defaults when no config provided", () => {
    const config = mapNodeHttpServerConfig();

    expect(config.name).toBe("http.server");
    expect(config.kind).toBe("node");
    expect(config.setsAsyncStorageContext).toBe(true);
  });

  test("does not have update phase", () => {
    const config = mapNodeHttpServerConfig();

    expect(config.trace?.start).toBeDefined();
    expect(config.trace?.update).toBeUndefined(); // No progress for Node HTTP
    expect(config.trace?.end).toBeDefined();
  });

  test("nativeDuration is undefined (manual tracking)", () => {
    const config = mapNodeHttpServerConfig();
    expect(config.nativeDuration).toBeUndefined();
  });

  test("extractSpanName uses method + path", () => {
    const config = mapNodeHttpServerConfig();

    const spanName = config.extractSpanName!({
      "http.request.method": "DELETE",
      "url.path": "/users/456",
    });

    expect(spanName).toBe("DELETE /users/456");
  });
});

describe("mapNodeSDKConfig", () => {
  test("maps all instruments with defaults", () => {
    const configs = mapNodeSDKConfig();

    expect(configs.http.name).toBe("http.server");
    expect(configs.fetch.name).toBe("http.client");
    expect(configs.node.name).toBe("http.server");
  });

  test("passes through instrument-specific config", () => {
    const configs = mapNodeSDKConfig({
      http: {
        captureAttributes: {
          requestHeaders: ["x-http-custom"],
        },
      },
      fetch: {
        captureAttributes: {
          requestHeaders: ["x-fetch-custom"],
        },
      },
      node: {
        captureAttributes: {
          requestHeaders: ["x-node-custom"],
        },
      },
    });

    expect(configs.http.trace?.start).toContain("http.request.header.x-http-custom");
    expect(configs.fetch.trace?.start).toContain("http.request.header.x-fetch-custom");
    expect(configs.node.trace?.start).toContain("http.request.header.x-node-custom");
  });

  test("enabled flag is respected", () => {
    const configs = mapNodeSDKConfig({
      http: { enabled: false },
      fetch: { enabled: true },
    });

    expect(configs.http.enabled).toBe(false);
    expect(configs.fetch.enabled).toBe(true);
    expect(configs.node.enabled).toBe(true); // default
  });
});

describe("header name mapping", () => {
  test("converts header names to lowercase", () => {
    const config = mapHttpServerConfig({
      captureAttributes: {
        requestHeaders: ["Content-Type", "USER-AGENT"],
      },
    });

    expect(config.trace?.start).toContain("http.request.header.content-type");
    expect(config.trace?.start).toContain("http.request.header.user-agent");
  });

  test("prefixes headers with semantic convention names", () => {
    const config = mapHttpServerConfig({
      captureAttributes: {
        requestHeaders: ["x-custom"],
        responseHeaders: ["x-trace-id"],
      },
    });

    expect(config.trace?.start).toContain("http.request.header.x-custom");
    expect(config.trace?.update).toContain("http.response.header.x-trace-id");
  });
});

describe("metrics configuration", () => {
  // TODO: Implement http.route support
  // Requires routing instrumentation in Zig layer (Bun.serve routes, Express, etc.)
  // http.route is critical for low-cardinality metrics - without it, every unique path creates a separate metric series
  test.skip("HTTP server includes route in metrics", () => {
    const config = mapHttpServerConfig();

    // Start dimensions (from Zig start phase)
    expect(config.metrics?.start).toContain("http.request.method");
    expect(config.metrics?.start).toContain("url.path");
    expect(config.metrics?.start).toContain("http.route");

    // End dimensions (from Zig end phase)
    expect(config.metrics?.end).toContain("http.response.status_code");
  });

  test("fetch client includes server.address in metrics", () => {
    const config = mapFetchClientConfig();

    expect(config.metrics?.end).toContain("http.request.method");
    expect(config.metrics?.end).toContain("server.address");
    expect(config.metrics?.end).toContain("http.response.status_code");
  });

  test("node HTTP server includes path in metrics", () => {
    const config = mapNodeHttpServerConfig();

    expect(config.metrics?.end).toContain("http.request.method");
    expect(config.metrics?.end).toContain("url.path");
    expect(config.metrics?.end).toContain("http.response.status_code");
  });
});

describe("distributed tracing configuration", () => {
  describe("distributedTracing: false", () => {
    test("disables header capture for HTTP server", () => {
      const config = mapHttpServerConfig({ distributedTracing: false });

      // Should not capture traceparent/tracestate headers
      expect(config.trace?.start).not.toContain("http.request.header.traceparent");
      expect(config.trace?.start).not.toContain("http.request.header.tracestate");
    });

    test("disables parent extraction for HTTP server", () => {
      const config = mapHttpServerConfig({ distributedTracing: false });

      // Should not have extractParentContext function
      expect(config.extractInboundTraceContext).toBeUndefined();
    });

    test("disables header injection for HTTP server", () => {
      const config = mapHttpServerConfig({ distributedTracing: false });

      // Should disable injection
      expect(config.injectHeaders).toBe(false);
    });

    test("disables parent extraction for Node HTTP server", () => {
      const config = mapNodeHttpServerConfig({ distributedTracing: false });

      expect(config.extractInboundTraceContext).toBeUndefined();
      expect(config.injectHeaders).toBe(false);
    });

    test("disables header injection for fetch client", () => {
      const config = mapFetchClientConfig({ distributedTracing: false });

      expect(config.injectHeaders).toBe(false);
    });
  });

  describe("link-only mode", () => {
    test("enables parent extraction when requestHeaderContext = 'link-only'", () => {
      const config = mapHttpServerConfig({
        distributedTracing: {
          server: { requestHeaderContext: "link-only" },
        },
      });

      // Should not extract parent (would create Link instead in future)
      expect(config.extractInboundTraceContext).toBeFunction();
      const result = config.extractInboundTraceContext!({
        "http.request.header.traceparent": "00-trace-span-01",
        "http.request.header.tracestate": "vendor=value",
      });
      expect(result.traceparent).toBe("00-trace-span-01");
      expect(result.tracestate).toBe("vendor=value");
      expect(result.linkOnly).toBe(true);
    });

    test("enables header capture in link-only mode", () => {
      const config = mapHttpServerConfig({
        distributedTracing: {
          server: { requestHeaderContext: "link-only" },
        },
      });

      // Must capture these headers in link mode (but not create a parent context)
      expect(config.trace?.start).toContain("http.request.header.traceparent");
      expect(config.trace?.start).toContain("http.request.header.tracestate");
    });

    test("still allows injection in link-only mode", () => {
      const config = mapHttpServerConfig({
        distributedTracing: {
          server: { requestHeaderContext: "link-only" },
        },
      });

      // Injection should still work (unless responseHeaders: false)
      expect(config.injectHeaders).toBe(true);
    });

    test("disables injection when responseHeaders: false in link-only", () => {
      const config = mapHttpServerConfig({
        distributedTracing: {
          server: {
            requestHeaderContext: "link-only",
            responseHeaders: false,
          },
        },
      });

      expect(config.injectHeaders).toBe(false);
    });
  });

  describe("injectHeaders: false", () => {
    test("disables header injection for HTTP server", () => {
      const config = mapHttpServerConfig({ injectHeaders: false });

      expect(config.injectHeaders).toBe(false);
    });

    test("disables header injection for Node HTTP server", () => {
      const config = mapNodeHttpServerConfig({ injectHeaders: false });

      expect(config.injectHeaders).toBe(false);
    });

    test("disables header injection for fetch client", () => {
      const config = mapFetchClientConfig({ injectHeaders: false });

      expect(config.injectHeaders).toBe(false);
    });

    test("still extracts parent context when only injection disabled", () => {
      const config = mapHttpServerConfig({ injectHeaders: false });

      // Should still extract parent (only injection disabled)
      expect(config.extractInboundTraceContext).toBeDefined();
    });
  });

  describe("default behavior (enabled)", () => {
    test("enables parent extraction by default for HTTP server", () => {
      const config = mapHttpServerConfig();

      expect(config.extractInboundTraceContext).toBeDefined();
      expect(config.injectHeaders).toBe(true);
    });

    test("enables parent extraction by default for Node HTTP server", () => {
      const config = mapNodeHttpServerConfig();

      expect(config.extractInboundTraceContext).toBeDefined();
      expect(config.injectHeaders).toBe(true);
    });

    test("enables header injection by default for fetch client", () => {
      const config = mapFetchClientConfig();

      expect(config.injectHeaders).toBe(true);
    });

    test("captures traceparent/tracestate by default for HTTP server", () => {
      const config = mapHttpServerConfig();

      expect(config.trace?.start).toContain("http.request.header.traceparent");
      expect(config.trace?.start).toContain("http.request.header.tracestate");
    });
  });
});
