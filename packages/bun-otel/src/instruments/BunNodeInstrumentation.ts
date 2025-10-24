/**
 * OpenTelemetry instrumentation for Node.js HTTP (http.createServer and http.request).
 *
 * This instrumentation uses Bun's native telemetry hooks (Bun.telemetry.attach)
 * to create SERVER spans for incoming HTTP requests and CLIENT spans for outgoing requests,
 * automatically handling W3C TraceContext headers for distributed tracing.
 *
 * Supports:
 * - Node.js http.createServer() - SERVER spans managed via .once() listeners on ServerResponse
 * - Node.js http.request() - CLIENT spans managed via .once() listeners on ClientRequest
 *
 * @module bun-otel/instruments/BunNodeInstrumentation
 */

import {
  context,
  Histogram,
  propagation,
  SpanKind,
  SpanStatusCode,
  ValueType,
  type MeterProvider,
  type Span,
  type TracerProvider,
} from "@opentelemetry/api";
import type { Instrumentation, InstrumentationConfig } from "@opentelemetry/instrumentation";
import { InstrumentRef, OpId } from "bun";
import { InstrumentKind } from "../../types";

import type { ClientRequest } from "http";
import { IncomingMessage, ServerResponse } from "http";
import { validateCaptureAttributes } from "../validation";

// Symbols for Node.js http span tracking
const kSpan = Symbol("kOtelSpan");

/**
 * Configuration options for BunNodeInstrumentation.
 */
export interface BunNodeInstrumentationConfig extends InstrumentationConfig {
  /**
   * HTTP headers to capture as span attributes.
   * Sensitive headers (authorization, cookie, etc.) are always blocked.
   */
  captureAttributes?: {
    /** Request headers to capture (e.g., ["user-agent", "content-type"]) */
    requestHeaders?: string[];
    /** Response headers to capture (e.g., ["content-type", "x-trace-id"]) */
    responseHeaders?: string[];
  };
}

/**
 * OpenTelemetry instrumentation for Node.js HTTP (both server and client).
 *
 * Unlike the official Node.js instrumentations that use monkey-patching via InstrumentationBase,
 * this implementation uses Bun's native telemetry hooks for zero-overhead instrumentation.
 *
 * Key features:
 * - Creates SERVER spans for all http.createServer() requests
 * - Creates CLIENT spans for all http.request() calls
 * - Automatically extracts/injects trace context via traceparent header
 * - Maps attributes to OTel semantic conventions v1.23.0+
 * - Handles errors and HTTP error status codes
 * - Uses .once() listeners for deferred attribute capture
 *
 * @example
 * ```typescript
 * import { BunNodeInstrumentation } from 'bun-otel';
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 *
 * const provider = new NodeTracerProvider();
 * const instrumentation = new BunNodeInstrumentation({
 *   captureAttributes: {
 *     requestHeaders: ['user-agent', 'content-type', 'x-request-id'],
 *     responseHeaders: ['content-type', 'x-trace-id'],
 *   },
 * });
 *
 * instrumentation.setTracerProvider(provider);
 * instrumentation.enable();
 *
 * // Now all http.createServer() and http.request() calls will be traced
 * import http from 'node:http';
 *
 * // Server will be instrumented
 * http.createServer((req, res) => {
 *   res.end('Hello from Node.js http!');
 * }).listen(3001);
 *
 * // Client will be instrumented
 * http.request('http://example.com', (res) => {
 *   // ...
 * }).end();
 * ```
 */
export class BunNodeInstrumentation implements Instrumentation<BunNodeInstrumentationConfig> {
  readonly instrumentationName = "@opentelemetry/instrumentation-bun-node";
  readonly instrumentationVersion = "0.1.0";

  private _config: BunNodeInstrumentationConfig;
  private _tracerProvider?: TracerProvider;
  private _meterProvider?: MeterProvider;
  private _instrumentId?: InstrumentRef;
  private _activeSpans: Map<number, Span> = new Map();

  // Track start times for manual duration calculation (Node.js bypasses onOperationEnd)
  private _startTimes: Map<number, number> = new Map();

  // Metric instruments for tracking HTTP duration (server + client)
  private _oldHttpServerDurationHistogram?: Histogram;
  private _stableHttpServerDurationHistogram?: Histogram;
  private _oldHttpClientDurationHistogram?: Histogram;
  private _stableHttpClientDurationHistogram?: Histogram;

  constructor(config: BunNodeInstrumentationConfig = {}) {
    this._config = { enabled: true, ...config };

    // Validate configuration at construction time
    if (this._config.captureAttributes) {
      validateCaptureAttributes(this._config.captureAttributes);
    }
  }

  /**
   * Check if attributes contain Node.js server request/response objects.
   */
  private isNodeServerAttributes(attributes: Record<string, any>): attributes is {
    http_req: IncomingMessage;
    http_res: ServerResponse;
  } {
    return Boolean(
      attributes["http_req"] &&
        attributes["http_res"] &&
        attributes["http_req"] instanceof IncomingMessage &&
        attributes["http_res"] instanceof ServerResponse,
    );
  }

  /**
   * Check if attributes contain Node.js client request object.
   * Client may or may not have a response yet (response arrives asynchronously).
   */
  private isNodeClientAttributes(attributes: Record<string, any>): attributes is {
    http_req: ClientRequest;
    http_res?: IncomingMessage;
  } {
    return Boolean(
      attributes["http_req"] &&
        // Check if it's a ClientRequest (has methods like abort, setHeader, etc.)
        typeof attributes["http_req"] === "object" &&
        "abort" in attributes["http_req"] &&
        "setHeader" in attributes["http_req"],
    );
  }

  /**
   * Extract content-length from a ServerResponse or IncomingMessage.
   * Handles both number and string values from getHeader().
   */
  private extractContentLength(response: ServerResponse | IncomingMessage): number {
    const contentLength = response.getHeader?.("content-length") || response.headers?.["content-length"];

    if (typeof contentLength === "number") {
      return contentLength;
    }

    if (typeof contentLength === "string") {
      const parsed = parseInt(contentLength, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    return 0;
  }

  /**
   * Setup .once() listeners on Node.js ServerResponse to capture response attributes
   * and handle SERVER span lifecycle. Adapted from the original BunHttpInstrumentation.
   */
  private setupNodeJsServerResponseListeners(id: OpId, span: Span, req: IncomingMessage, res: ServerResponse): void {
    // Store span on response object for potential later use
    (res as any)[kSpan] = span;

    // Handle successful request completion
    res.once("finish", () => {
      // Update span with final attributes if not already set
      const statusCode = res.statusCode;
      if (statusCode) {
        span.setAttribute("http.response.status_code", statusCode);

        const contentLength = this.extractContentLength(res);
        if (contentLength > 0) {
          span.setAttribute("http.response.body.size", contentLength);
        }

        // Add captured response headers if configured
        if (this._config.captureAttributes?.responseHeaders) {
          for (const headerName of this._config.captureAttributes.responseHeaders) {
            const value = res.getHeader(headerName);
            if (value !== undefined) {
              const attrKey = `http.response.header.${headerName}`;
              span.setAttribute(attrKey, Array.isArray(value) ? value[0] : String(value));
            }
          }
        }

        // Set span status based on HTTP status code
        if (statusCode >= 500) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${statusCode}`,
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
      }

      // Record metrics if meter provider is configured
      const startTime = this._startTimes.get(id);
      if (this._oldHttpServerDurationHistogram && startTime !== undefined) {
        const durationMs = performance.now() - startTime;
        const durationS = durationMs / 1000;

        // Build metric attributes (subset of span attributes for cardinality control)
        const metricAttributes: Record<string, any> = {
          "http.request.method": req.method,
          "http.response.status_code": statusCode,
        };

        // Record to old histogram (milliseconds)
        this._oldHttpServerDurationHistogram.record(durationMs, metricAttributes);

        // Record to stable histogram (seconds)
        if (this._stableHttpServerDurationHistogram) {
          this._stableHttpServerDurationHistogram.record(durationS, metricAttributes);
        }
      }
      this._startTimes.delete(id);

      span.end();
      this._activeSpans.delete(id);
    });

    // Handle request errors
    res.once("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err ?? "Unknown error"));
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.end();
      this._startTimes.delete(id);
      this._activeSpans.delete(id);
    });

    // Handle connection close (client aborted)
    res.once("close", () => {
      // Only record abort if span hasn't ended already
      if (this._activeSpans.has(id)) {
        span.recordException(new Error("Request aborted"));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Request aborted",
        });
        span.end();
        this._startTimes.delete(id);
        this._activeSpans.delete(id);
      }
    });

    // Handle request timeout
    res.once("timeout", () => {
      if (this._activeSpans.has(id)) {
        span.recordException(new Error("Request timeout"));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Request timeout",
        });
        span.end();
        this._startTimes.delete(id);
        this._activeSpans.delete(id);
      }
    });
  }

  /**
   * Setup .once() listeners on Node.js ClientRequest to capture CLIENT span lifecycle.
   * Handles both successful responses and errors.
   */
  private setupNodeJsClientRequestListeners(id: OpId, span: Span, req: ClientRequest, res?: IncomingMessage): void {
    // Store span on request object
    (req as any)[kSpan] = span;

    // Handle successful response
    req.once("response", (response: IncomingMessage) => {
      // Capture response status code
      const statusCode = response.statusCode || 0;
      span.setAttribute("http.response.status_code", statusCode);

      // Capture content-length if available
      const contentLength = this.extractContentLength(response);
      if (contentLength > 0) {
        span.setAttribute("http.response.body.size", contentLength);
      }

      // Add captured response headers if configured
      if (this._config.captureAttributes?.responseHeaders) {
        for (const headerName of this._config.captureAttributes.responseHeaders) {
          const value = response.headers[headerName];
          if (value !== undefined) {
            const attrKey = `http.response.header.${headerName}`;
            span.setAttribute(attrKey, Array.isArray(value) ? value[0] : String(value));
          }
        }
      }

      // Set span status based on HTTP status code
      if (statusCode >= 500) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${statusCode}`,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      // Wait for response to end before ending span
      response.once("end", () => {
        // Record metrics if meter provider is configured
        const startTime = this._startTimes.get(id);
        if (this._oldHttpClientDurationHistogram && startTime !== undefined) {
          const durationMs = performance.now() - startTime;
          const durationS = durationMs / 1000;

          // Build metric attributes (subset of span attributes for cardinality control)
          const metricAttributes: Record<string, any> = {
            "http.request.method": (req as any).method || "GET",
            "http.response.status_code": statusCode,
          };

          // Record to old histogram (milliseconds)
          this._oldHttpClientDurationHistogram.record(durationMs, metricAttributes);

          // Record to stable histogram (seconds)
          if (this._stableHttpClientDurationHistogram) {
            this._stableHttpClientDurationHistogram.record(durationS, metricAttributes);
          }
        }
        this._startTimes.delete(id);

        span.end();
        this._activeSpans.delete(id);
      });

      // Handle response errors
      response.once("error", (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err ?? "Unknown error"));
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        span.end();
        this._startTimes.delete(id);
        this._activeSpans.delete(id);
      });
    });

    // Handle request errors (connection errors, timeouts, etc.)
    req.once("error", (err: unknown) => {
      // Only record error if span hasn't ended already
      if (this._activeSpans.has(id)) {
        const error = err instanceof Error ? err : new Error(String(err ?? "Unknown error"));
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        span.end();
        this._startTimes.delete(id);
        this._activeSpans.delete(id);
      }
    });

    // Handle request abort
    req.once("abort", () => {
      if (this._activeSpans.has(id)) {
        span.recordException(new Error("Request aborted"));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Request aborted",
        });
        span.end();
        this._startTimes.delete(id);
        this._activeSpans.delete(id);
      }
    });

    // Handle request timeout
    req.once("timeout", () => {
      if (this._activeSpans.has(id)) {
        span.recordException(new Error("Request timeout"));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Request timeout",
        });
        span.end();
        this._startTimes.delete(id);
        this._activeSpans.delete(id);
      }
    });
  }

  /**
   * Enable instrumentation by attaching to Bun's native telemetry hooks.
   * Creates SERVER spans for http.createServer() and CLIENT spans for http.request().
   */
  enable(): void {
    if (!this._config.enabled) {
      return;
    }

    if (!this._tracerProvider) {
      throw new Error("TracerProvider not set. Call setTracerProvider() before enable().");
    }

    // Check if running in Bun environment
    if (typeof Bun === "undefined" || !Bun.telemetry) {
      throw new TypeError(
        "Bun.telemetry is not available. This instrumentation requires Bun runtime. " + "Install from https://bun.sh",
      );
    }

    const tracer = this._tracerProvider.getTracer(this.instrumentationName, this.instrumentationVersion);

    // Attach to Bun's native hooks for Node.js HTTP operations
    this._instrumentId = Bun.telemetry.attach({
      type: InstrumentKind.Node,
      name: this.instrumentationName,
      version: this.instrumentationVersion,
      captureAttributes: this._config.captureAttributes,
      injectHeaders: {
        request: ["traceparent", "tracestate"], // For client requests
        response: ["traceparent", "tracestate"], // For server responses
      },

      onOperationStart: (id: OpId, attributes: Record<string, any>) => {
        // Determine if this is a server or client operation
        const isServer = this.isNodeServerAttributes(attributes);
        const isClient = this.isNodeClientAttributes(attributes);

        if (isServer) {
          this.handleServerOperationStart(id, attributes, tracer);
        } else if (isClient) {
          this.handleClientOperationStart(id, attributes, tracer);
        }
      },

      onOperationEnd: (id: number, attributes: Record<string, any>) => {
        const span = this._activeSpans.get(id);
        if (!span) {
          return;
        }

        // For Node.js operations, the .once() listeners handle span lifecycle
        // Skip processing here to avoid duplicate span.end() calls
        // The listeners will handle both server and client operations
      },

      onOperationError: (id: number, attributes: Record<string, any>) => {
        const span = this._activeSpans.get(id);
        if (!span) {
          return;
        }

        // For Node.js operations, the .once() listeners handle errors
        // Skip processing here to avoid duplicate error recording
      },

      onOperationInject: (id: OpId, _data?: unknown) => {
        const span = this._activeSpans.get(id);
        if (!span) {
          return undefined;
        }

        // Construct W3C traceparent header from span context
        const spanContext = span.spanContext();
        const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16).padStart(2, "0")}`;

        // Extract tracestate if present
        const tracestate = spanContext.traceState?.serialize() || "";

        // Return array matching injectHeaders order: ["traceparent", "tracestate"]
        return [traceparent, tracestate];
      },
    });
  }

  /**
   * Handle SERVER operation start (http.createServer).
   */
  private handleServerOperationStart(
    id: OpId,
    attributes: Record<string, any>,
    tracer: ReturnType<TracerProvider["getTracer"]>,
  ): void {
    const nodeRequest = attributes["http_req"] as IncomingMessage;
    const nodeResponse = attributes["http_res"] as ServerResponse;

    // Extract span name from HTTP method and path
    const method = nodeRequest.method || "HTTP";
    const url = nodeRequest.url || "/";
    const spanName = `${method} ${url}`;

    // Extract parent context if traceparent header present
    let parentContext = context.active();
    const traceparentHeader = nodeRequest.headers["traceparent"];
    if (traceparentHeader) {
      parentContext = propagation.extract(context.active(), nodeRequest.headers, {
        get: (carrier, key) => {
          return Array.isArray(carrier[key]) ? carrier[key][0] : carrier[key];
        },
        keys: carrier => Object.keys(carrier),
      });
    }

    // Create SERVER span with parent context
    const span = tracer.startSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: {
          // Map to OTel semantic conventions
          "http.request.method": method,
          "url.path": url,
          "url.scheme": nodeRequest.socket?.encrypted ? "https" : "http",
          "server.address": nodeRequest.headers.host || "localhost",
        },
      },
      parentContext,
    );

    // Add captured request headers if configured
    if (this._config.captureAttributes?.requestHeaders) {
      for (const headerName of this._config.captureAttributes.requestHeaders) {
        const value = nodeRequest.headers[headerName];
        if (value !== undefined) {
          const attrKey = `http.request.header.${headerName}`;
          span.setAttribute(attrKey, Array.isArray(value) ? value[0] : String(value));
        }
      }
    }

    // Store span for later retrieval
    this._activeSpans.set(id, span);

    // Track start time for manual duration calculation
    this._startTimes.set(id, performance.now());

    // Setup .once() listeners to capture response attributes
    this.setupNodeJsServerResponseListeners(id, span, nodeRequest, nodeResponse);
  }

  /**
   * Handle CLIENT operation start (http.request).
   */
  private handleClientOperationStart(
    id: OpId,
    attributes: Record<string, any>,
    tracer: ReturnType<TracerProvider["getTracer"]>,
  ): void {
    const nodeRequest = attributes["http_req"] as ClientRequest;
    const nodeResponse = attributes["http_res"] as IncomingMessage | undefined;

    // Extract request details from ClientRequest
    // ClientRequest has method, protocol, path, host, port properties
    const method = (nodeRequest as any).method || "GET";
    const protocol = (nodeRequest as any).protocol || "http:";
    const path = (nodeRequest as any).path || "/";
    const host = (nodeRequest as any).host || "localhost";

    // Extract span name from HTTP method and path
    const spanName = `${method} ${path}`;

    // Create CLIENT span
    const span = tracer.startSpan(
      spanName,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          // Map ClientRequest attributes to OTel semantic conventions
          "http.request.method": method,
          "url.path": path,
          "url.scheme": protocol.replace(":", ""),
          "server.address": host,
        },
      },
      context.active(),
    );

    // Add captured request headers if configured
    if (this._config.captureAttributes?.requestHeaders) {
      const headers = (nodeRequest as any).getHeaders?.() || {};
      for (const headerName of this._config.captureAttributes.requestHeaders) {
        const value = headers[headerName];
        if (value !== undefined) {
          const attrKey = `http.request.header.${headerName}`;
          span.setAttribute(attrKey, Array.isArray(value) ? value[0] : String(value));
        }
      }
    }

    // Store span for later retrieval
    this._activeSpans.set(id, span);

    // Track start time for manual duration calculation
    this._startTimes.set(id, performance.now());

    // Setup .once() listeners to capture response
    this.setupNodeJsClientRequestListeners(id, span, nodeRequest, nodeResponse);
  }

  /**
   * Disable instrumentation by detaching from Bun's native hooks.
   */
  disable(): void {
    if (this._instrumentId !== undefined) {
      Bun.telemetry.detach(this._instrumentId);
      this._instrumentId = undefined;
    }

    // Clean up any remaining spans
    this._activeSpans.clear();
  }

  /**
   * Set the TracerProvider to use for creating spans.
   */
  setTracerProvider(tracerProvider: TracerProvider): void {
    this._tracerProvider = tracerProvider;
  }

  /**
   * Set the MeterProvider and create metric instruments.
   * Creates histograms for tracking HTTP server and client request duration.
   */
  setMeterProvider(meterProvider: MeterProvider): void {
    this._meterProvider = meterProvider;
    const meter = meterProvider.getMeter(this.instrumentationName, this.instrumentationVersion);

    // Old convention: http.server.duration (milliseconds)
    this._oldHttpServerDurationHistogram = meter.createHistogram("http.server.duration", {
      description: "Measures the duration of inbound HTTP requests.",
      unit: "ms",
      valueType: ValueType.DOUBLE,
    });

    // Stable convention: http.server.request.duration (seconds)
    this._stableHttpServerDurationHistogram = meter.createHistogram("http.server.request.duration", {
      description: "Duration of HTTP server requests.",
      unit: "s",
      valueType: ValueType.DOUBLE,
      advice: {
        explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
      },
    });

    // Old convention: http.client.duration (milliseconds)
    this._oldHttpClientDurationHistogram = meter.createHistogram("http.client.duration", {
      description: "Measures the duration of outbound HTTP requests.",
      unit: "ms",
      valueType: ValueType.DOUBLE,
    });

    // Stable convention: http.client.request.duration (seconds)
    this._stableHttpClientDurationHistogram = meter.createHistogram("http.client.request.duration", {
      description: "Duration of HTTP client requests.",
      unit: "s",
      valueType: ValueType.DOUBLE,
      advice: {
        explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
      },
    });
  }

  /**
   * Update instrumentation configuration.
   * Note: Changes require disable() + enable() to take effect.
   */
  setConfig(config: BunNodeInstrumentationConfig): void {
    // Validate new configuration
    if (config.captureAttributes) {
      validateCaptureAttributes(config.captureAttributes);
    }

    this._config = { ...this._config, ...config };
  }

  /**
   * Get current instrumentation configuration.
   */
  getConfig(): BunNodeInstrumentationConfig {
    return { ...this._config };
  }
}
