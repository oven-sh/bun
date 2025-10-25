/**
 * OpenTelemetry instrumentation for Node.js HTTP server (http.createServer).
 *
 * This instrumentation uses Bun's native telemetry hooks (Bun.telemetry.attach)
 * to create SERVER spans for incoming HTTP requests, automatically handling
 * W3C TraceContext headers for distributed tracing.
 *
 * Note: This instrumentation ONLY handles http.createServer() SERVER spans.
 * CLIENT spans for http.request() are handled by BunFetchInstrumentation,
 * since Bun's http.request() implementation uses fetch() internally.
 *
 * Supports:
 * - Node.js http.createServer() - SERVER spans managed via .once() listeners on ServerResponse
 *
 * @module bun-otel/instruments/BunNodeInstrumentation
 */

import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  ValueType,
  type Histogram,
  type MeterProvider,
  type Context as OtelContext,
  type Span,
  type TracerProvider,
} from "@opentelemetry/api";
import {
  ATTR_HTTP_REQUEST_HEADER,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_HEADER,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_URL_SCHEME,
} from "@opentelemetry/semantic-conventions";
import type { Instrumentation, InstrumentationConfig } from "@opentelemetry/instrumentation";
import { AsyncLocalStorage } from "async_hooks";
import { InstrumentRef, OpId } from "bun";

import { IncomingMessage, ServerResponse } from "http";
import { validateCaptureAttributes } from "../validation";
import { parseUrlAndHost } from "../url-utils";
import { ATTR_HTTP_RESPONSE_BODY_SIZE } from "@opentelemetry/semantic-conventions/incubating";

// Symbols for Node.js http span tracking
const kSpan = Symbol("kOtelSpan");

/**
 * Configuration options for BunNodeInstrumentation.
 *
 * Note: This instrumentation is SERVER-only. CLIENT spans for http.request()
 * are handled by BunFetchInstrumentation since Bun's http.request() uses fetch() internally.
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

  /**
   * Shared AsyncLocalStorage instance for context propagation.
   * Provided by BunSDK to enable trace context sharing between instrumentations.
   * @internal
   */
  contextStorage?: AsyncLocalStorage<OtelContext>;
}

/**
 * OpenTelemetry instrumentation for Node.js HTTP server (http.createServer).
 *
 * Unlike the official Node.js instrumentations that use monkey-patching via InstrumentationBase,
 * this implementation uses Bun's native telemetry hooks for zero-overhead instrumentation.
 *
 * Key features:
 * - Creates SERVER spans for all http.createServer() requests
 * - Automatically extracts trace context from incoming traceparent header
 * - Maps attributes to OTel semantic conventions v1.23.0+
 * - Handles errors and HTTP error status codes
 * - Uses .once() listeners for deferred attribute capture
 *
 * Note: CLIENT spans for http.request() are NOT handled by this instrumentation.
 * They are handled by BunFetchInstrumentation, since Bun's http.request() implementation
 * uses fetch() internally.
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
 * // Now all http.createServer() requests will be traced
 * import http from 'node:http';
 *
 * http.createServer((req, res) => {
 *   res.end('Hello from Node.js http!');
 * }).listen(3001);
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
  private _contextStorage?: AsyncLocalStorage<OtelContext>;

  // Track start times for manual duration calculation (Node.js bypasses onOperationEnd)
  private _startTimes: Map<number, number> = new Map();

  // Metric instruments for tracking HTTP server duration
  private _oldHttpServerDurationHistogram?: Histogram;
  private _stableHttpServerDurationHistogram?: Histogram;

  constructor(config: BunNodeInstrumentationConfig = {}) {
    // Per OpenTelemetry spec: enabled defaults to FALSE in constructor
    // registerInstrumentations() will call enable() after setting TracerProvider
    this._config = { enabled: false, ...config };
    this._contextStorage = config.contextStorage;

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
   * Extract content-length from a ServerResponse or IncomingMessage.
   * Handles both number and string values from getHeader().
   */
  private extractContentLength(response: ServerResponse | IncomingMessage): number {
    const contentLength =
      response instanceof ServerResponse
        ? response.getHeader?.("content-length")
        : response.headers?.["content-length"];

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
        span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, statusCode);

        const contentLength = this.extractContentLength(res);
        if (contentLength > 0) {
          span.setAttribute(ATTR_HTTP_RESPONSE_BODY_SIZE, contentLength);
        }

        // Add captured response headers if configured
        if (this._config.captureAttributes?.responseHeaders) {
          for (const headerName of this._config.captureAttributes.responseHeaders) {
            const value = res.getHeader(headerName);
            if (value !== undefined) {
              const attrKey = ATTR_HTTP_RESPONSE_HEADER(headerName);
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
          [ATTR_HTTP_REQUEST_METHOD]: req.method,
          [ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode,
        };

        // Record to old histogram (milliseconds)
        this._oldHttpServerDurationHistogram.record(durationMs, metricAttributes);

        // Record to stable histogram (seconds)
        if (this._stableHttpServerDurationHistogram) {
          this._stableHttpServerDurationHistogram.record(durationS, metricAttributes);
        }
      }
      span.end();
      this._cleanupAfterSpanEnd(id);
    });

    // Handle request errors
    res.once("error", (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
      this._endSpanWithError(id, span, message, err);
    });

    // Handle connection close (client aborted)
    res.once("close", () => {
      this._endSpanWithError(id, span, "Request aborted");
    });

    // Handle request timeout
    res.once("timeout", () => {
      this._endSpanWithError(id, span, "Request timeout");
    });
  }

  /**
   * Common cleanup logic after a span has been ended.
   * Removes bookkeeping (ALS context is cleared by Disposable when onNodeHTTPRequest exits).
   */
  private _cleanupAfterSpanEnd(id: number): void {
    this._startTimes.delete(id);
    this._activeSpans.delete(id);
  }

  /**
   * Unified handler for error/abort/timeout style terminations.
   */
  private _endSpanWithError(id: number, span: Span, message: string, err?: unknown): void {
    if (!this._activeSpans.has(id)) return;
    const error = err instanceof Error ? err : new Error(message);
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    span.end();
    this._cleanupAfterSpanEnd(id);
  }

  /**
   * Enable instrumentation by attaching to Bun's native telemetry hooks.
   * Creates SERVER spans for http.createServer() requests.
   */
  enable(): void {
    // Check if running in Bun environment
    if (typeof Bun === "undefined" || !Bun.telemetry) {
      throw new TypeError(
        "Bun.telemetry is not available. This instrumentation requires Bun runtime. " + "Install from https://bun.sh",
      );
    }

    // Mark as enabled
    this._config.enabled = true;

    // Get tracer (use explicit provider if set, otherwise use global API)
    // Per Node.js SDK: gracefully degrades if no provider is set (uses noop tracer from global API)
    const tracer =
      this._tracerProvider?.getTracer(this.instrumentationName, this.instrumentationVersion) ||
      trace.getTracer(this.instrumentationName, this.instrumentationVersion);

    // Attach to Bun's native hooks for Node.js HTTP operations
    this._instrumentId = Bun.telemetry.attach({
      type: "node",
      name: this.instrumentationName,
      version: this.instrumentationVersion,
      captureAttributes: this._config.captureAttributes,
      injectHeaders: {
        request: ["traceparent", "tracestate"], // For client requests
        response: ["traceparent", "tracestate"], // For server responses
      },

      onOperationStart: (id: OpId, attributes: Record<string, any>) => {
        if (this.isNodeServerAttributes(attributes)) {
          this.handleServerOperationStart(id, attributes, tracer);
          // Return a Disposable to clear ALS context when onNodeHTTPRequest exits
          return {
            [Symbol.dispose]: () => {
              if (this._contextStorage) {
                this._contextStorage.enterWith(undefined as any);
              }
            },
          };
        }
      },

      onOperationEnd: (id: number, _attributes: Record<string, any>) => {
        const span = this._activeSpans.get(id);
        if (!span) return;
        // Lifecycle handled by response listeners
      },

      onOperationError: (id: number, _attributes: Record<string, any>) => {
        const span = this._activeSpans.get(id);
        if (!span) return;
        // Errors handled by response listeners
      },

      onOperationInject: (id: OpId) => {
        const span = this._activeSpans.get(id);
        if (!span) return undefined;
        const spanContext = span.spanContext();
        const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16).padStart(2, "0")}`;
        const tracestate = spanContext.traceState?.serialize() || "";
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

    // Store OpId on response object for subsequent telemetry calls (e.g., notifyInject)
    (nodeResponse as any)._telemetry_op_id = id;

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
          [ATTR_HTTP_REQUEST_METHOD]: method,
          // Node's TLSSocket extends net.Socket and adds `encrypted`; cast to any to avoid type narrowing issues
          [ATTR_URL_SCHEME]: (nodeRequest.socket as any)?.encrypted ? "https" : "http",
          ...parseUrlAndHost(url || "/", (nodeRequest.headers.host as string | undefined) || "localhost"),
        },
      },
      parentContext,
    );

    // Add captured request headers if configured
    if (this._config.captureAttributes?.requestHeaders) {
      for (const headerName of this._config.captureAttributes.requestHeaders) {
        const value = nodeRequest.headers[headerName];
        if (value !== undefined) {
          const attrKey = ATTR_HTTP_REQUEST_HEADER(headerName);
          span.setAttribute(attrKey, Array.isArray(value) ? value[0] : String(value));
        }
      }
    }

    // Store span for later retrieval
    this._activeSpans.set(id, span);

    // Track start time for manual duration calculation
    this._startTimes.set(id, performance.now());

    // Update AsyncLocalStorage with SERVER span context
    // This makes the span available via context.active() for downstream calls (e.g., fetch)
    if (this._contextStorage) {
      const spanContext = trace.setSpan(parentContext, span);
      this._contextStorage.enterWith(spanContext);
    }

    // Setup .once() listeners to capture response attributes
    this.setupNodeJsServerResponseListeners(id, span, nodeRequest, nodeResponse);
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
   * Creates histograms for tracking HTTP server request duration.
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
