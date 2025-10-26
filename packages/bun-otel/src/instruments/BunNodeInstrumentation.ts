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
  type MeterProvider,
  type Span,
} from "@opentelemetry/api";
import { OpId } from "bun";
import {
  ATTR_HTTP_REQUEST_HEADER,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_BODY_SIZE,
  ATTR_HTTP_RESPONSE_HEADER,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_URL_SCHEME,
} from "../semconv";

import { IncomingMessage, ServerResponse } from "http";
import { parseUrlAndHost } from "../url-utils";
import { migrateToCaptureAttributes, validateCaptureAttributes } from "../validation";
import { BunAbstractInstrumentation } from "./BunAbstractInstrumentation";
import { BunHttpInstrumentationConfig } from "./config";

// Symbols for Node.js http span tracking
const kSpan = Symbol("kOtelSpan");

/**
 * Configuration options for BunNodeInstrumentation.
 * Re-export of shared HTTP config for backwards compatibility.
 *
 * Note: This instrumentation is SERVER-only. CLIENT spans for http.request()
 * are handled by BunFetchInstrumentation since Bun's http.request() uses fetch() internally.
 */
export type BunNodeInstrumentationConfig = BunHttpInstrumentationConfig;

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
export class BunNodeInstrumentation extends BunAbstractInstrumentation<BunNodeInstrumentationConfig> {
  // Track start times for manual duration calculation (Node.js bypasses onOperationEnd)
  private _startTimes: Map<number, number> = new Map();

  constructor(config: BunNodeInstrumentationConfig = {}) {
    // Marker for auto-generated config (survives structuredClone unlike Symbol)
    const MIGRATED_MARKER = "__bun_otel_migrated__";

    // Normalize config BEFORE passing to super() to prevent migration from merging old+new headers
    if (config.captureAttributes && !config.headersToSpanAttributes) {
      config.headersToSpanAttributes = {
        server: {
          requestHeaders: config.captureAttributes.requestHeaders,
          responseHeaders: config.captureAttributes.responseHeaders,
        },
        [MIGRATED_MARKER]: true, // Mark as auto-generated
      } as any;
    }

    // Create validator for security checks
    const validate = (cfg: BunNodeInstrumentationConfig): BunNodeInstrumentationConfig => {
      const headerConfig = cfg.headersToSpanAttributes?.server || cfg.captureAttributes;
      if (headerConfig) {
        validateCaptureAttributes(headerConfig);
      }
      return cfg;
    };

    super("@opentelemetry/instrumentation-bun-node", "0.1.0", "node", config, [
      migrateToCaptureAttributes((cfg: BunNodeInstrumentationConfig) => cfg?.headersToSpanAttributes?.server),
      validate,
    ]);
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
   * Override cleanup hook to also remove start times on error.
   */
  protected onErrorCleanup(id: number): void {
    this._startTimes.delete(id);
  }

  /**
   * Customize the native instrument definition with Node.js HTTP server-specific hooks.
   */
  protected _customizeNativeInstrument(instrument: Bun.NativeInstrument): Bun.NativeInstrument {
    // Extract header configuration
    const requestHeaders =
      this._config.headersToSpanAttributes?.server?.requestHeaders || this._config.captureAttributes?.requestHeaders;
    const responseHeaders =
      this._config.headersToSpanAttributes?.server?.responseHeaders || this._config.captureAttributes?.responseHeaders;

    return {
      ...instrument,
      type: "node",
      name: this.instrumentationName,
      version: this.instrumentationVersion,
      captureAttributes:
        requestHeaders || responseHeaders
          ? {
              requestHeaders,
              responseHeaders,
            }
          : undefined,
      injectHeaders: {
        request: ["traceparent", "tracestate"], // For client requests
        response: ["traceparent", "tracestate"], // For server responses
      },

      onOperationStart: (id: OpId, attributes: Record<string, any>) => {
        if (this.isNodeServerAttributes(attributes)) {
          this.handleServerOperationStart(id, attributes);
          // Return a Disposable to clear ALS context when onNodeHTTPRequest exits
          return {
            [Symbol.dispose]: () => {
              if (this._contextStorage) {
                this._contextStorage.enterWith(undefined as any);
              }
            },
          };
        }
        return undefined;
      },

      onOperationEnd: (id: number, _attributes: Record<string, any>) => {
        const span = this._internalSpanGet(id);
        if (!span) return;
        // Lifecycle handled by response listeners
      },

      onOperationError: (id: number, _attributes: Record<string, any>) => {
        const span = this._internalSpanGet(id);
        if (!span) return;
        // Errors handled by response listeners
      },

      onOperationInject: (id: OpId) => this.generateTraceHeaders(id),
    };
  }

  /**
   * Handle SERVER operation start (http.createServer).
   */
  private handleServerOperationStart(id: OpId, attributes: Record<string, any>): void {
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
    const span = this.getTracer().startSpan(
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
   * Set the MeterProvider and create metric instruments.
   * Creates histograms for tracking HTTP server request duration.
   * Per Node.js SDK: optional, metrics will be noop if not set.
   */
  setMeterProvider(meterProvider: MeterProvider): void {
    super.setMeterProvider(meterProvider);
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
}
