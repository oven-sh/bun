/**
 * OpenTelemetry instrumentation for Bun's native HTTP server (Bun.serve).
 *
 * This instrumentation uses Bun's native telemetry hooks (Bun.telemetry.attach)
 * to create SERVER spans for all incoming HTTP requests, automatically extracting
 * W3C TraceContext headers for distributed tracing.
 *
 * Compatible with @opentelemetry/instrumentation-http configuration format.
 *
 * For Node.js http.createServer() and http.request(), use BunNodeInstrumentation instead.
 *
 * @module bun-otel/instruments/BunHttpInstrumentation
 */

import {
  Attributes,
  Context,
  context,
  propagation,
  SpanKind,
  trace,
  ValueType,
  type MeterProvider,
  type Span,
} from "@opentelemetry/api";
import type { InstrumentationConfig } from "@opentelemetry/instrumentation";
import { AsyncLocalStorage } from "async_hooks";
import { OpId } from "bun";
import type { IncomingMessage, ServerResponse } from "http";
import {
  ATTR_HTTP_REQUEST_HEADER,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_ROUTE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_PATH,
  ATTR_URL_QUERY,
  ATTR_URL_SCHEME,
  TRACEPARENT,
  TRACESTATE,
} from "../semconv";
import { migrateToCaptureAttributes, validateCaptureAttributes } from "../validation";
import { BunAbstractInstrumentation } from "./BunAbstractInstrumentation";

/**
 * Hook function for ignoring incoming requests based on custom criteria.
 */
export interface IgnoreIncomingRequestFunction {
  (request: IncomingMessage): boolean;
}

/**
 * Hook function for adding custom attributes to spans.
 */
export interface HttpCustomAttributeFunction {
  (span: Span, request: IncomingMessage, response: ServerResponse): void;
}

/**
 * Hook function for adding custom attributes during request processing.
 */
export interface HttpRequestCustomAttributeFunction {
  (span: Span, request: IncomingMessage): void;
}

/**
 * Hook function for adding custom attributes during response processing.
 */
export interface HttpResponseCustomAttributeFunction {
  (span: Span, response: ServerResponse): void;
}

/**
 * Hook function for adding custom attributes before a span is started.
 */
export interface StartIncomingSpanCustomAttributeFunction {
  (request: IncomingMessage): Attributes;
}

/**
 * Configuration options for BunHttpInstrumentation.
 * Compatible with @opentelemetry/instrumentation-http HttpInstrumentationConfig.
 *
 * All options are optional to match Node.js SDK behavior.
 */
export interface BunHttpInstrumentationConfig extends InstrumentationConfig {
  /**
   * Function to determine if incoming request should be ignored.
   * @example
   * ```typescript
   * ignoreIncomingRequestHook: (req) => req.url?.includes('/health')
   * ```
   */
  ignoreIncomingRequestHook?: IgnoreIncomingRequestFunction;

  /**
   * If set to true, incoming requests will not be instrumented at all.
   * @default false
   */
  disableIncomingRequestInstrumentation?: boolean;

  /**
   * Function for adding custom attributes after response is handled.
   * Called with final span, request, and response.
   */
  applyCustomAttributesOnSpan?: HttpCustomAttributeFunction;

  /**
   * Function for adding custom attributes before request is handled.
   * Called early in span lifecycle with request only.
   */
  requestHook?: HttpRequestCustomAttributeFunction;

  /**
   * Function for adding custom attributes before response is handled.
   * Called with span and response when response starts.
   */
  responseHook?: HttpResponseCustomAttributeFunction;

  /**
   * Function for adding custom attributes before a span is started in incoming request.
   * Returned attributes are added to span at creation time.
   */
  startIncomingSpanHook?: StartIncomingSpanCustomAttributeFunction;

  /**
   * The primary server name of the matched virtual host.
   * Sets server.address attribute if provided.
   */
  serverName?: string;

  /**
   * Require parent span to create span for incoming requests.
   * If true and no parent context, span will not be created.
   * @default false
   */
  requireParentforIncomingSpans?: boolean;

  /**
   * Map HTTP headers to span attributes.
   * Compatible with Node.js SDK format.
   * @example
   * ```typescript
   * headersToSpanAttributes: {
   *   server: {
   *     requestHeaders: ['user-agent', 'content-type'],
   *     responseHeaders: ['content-type', 'x-trace-id']
   *   }
   * }
   * ```
   */
  headersToSpanAttributes?: {
    server?: {
      requestHeaders?: string[];
      responseHeaders?: string[];
    };
  };

  /**
   * @deprecated Use headersToSpanAttributes instead.
   * Legacy format for backward compatibility.
   * HTTP headers to capture as span attributes.
   */
  captureAttributes?: {
    requestHeaders?: string[];
    responseHeaders?: string[];
  };

  /**
   * Enable automatic population of synthetic source type based on user-agent header.
   * @experimental
   * @default false
   */
  enableSyntheticSourceDetection?: boolean;

  /**
   * Shared AsyncLocalStorage instance for context propagation.
   * Provided by BunSDK to enable trace context sharing between instrumentations.
   * @internal
   */
  contextStorage?: AsyncLocalStorage<Context>;
}

/**
 * OpenTelemetry instrumentation for Bun's native HTTP server (Bun.serve).
 *
 * Unlike Node.js instrumentations that use monkey-patching via InstrumentationBase,
 * this implementation uses Bun's native telemetry hooks for zero-overhead instrumentation.
 *
 * Key features:
 * - Creates SERVER spans for all incoming HTTP requests (Bun.serve)
 * - Automatically extracts trace context from traceparent header
 * - Maps native attributes to OTel semantic conventions v1.23.0+
 * - Handles errors and HTTP error status codes
 * - Supports HTTP route patterns when available
 * - All providers optional (uses global APIs by default)
 *
 * @example Basic usage
 * ```typescript
 * import { BunHttpInstrumentation } from 'bun-otel';
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 *
 * const provider = new NodeTracerProvider();
 * const instrumentation = new BunHttpInstrumentation({
 *   headersToSpanAttributes: {
 *     server: {
 *       requestHeaders: ['user-agent', 'content-type'],
 *       responseHeaders: ['content-type']
 *     }
 *   }
 * });
 *
 * instrumentation.setTracerProvider(provider);
 * instrumentation.enable();
 * ```
 *
 * @example Using global APIs (no explicit provider)
 * ```typescript
 * import { BunHttpInstrumentation } from 'bun-otel';
 * import { trace } from '@opentelemetry/api';
 *
 * // Register provider globally first
 * trace.setGlobalTracerProvider(provider);
 *
 * // Instrumentation will use global API automatically
 * const instrumentation = new BunHttpInstrumentation();
 * instrumentation.enable();
 * ```
 */
export class BunHttpInstrumentation extends BunAbstractInstrumentation<BunHttpInstrumentationConfig> {
  constructor(config: BunHttpInstrumentationConfig = {}) {
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
    const validate = (cfg: BunHttpInstrumentationConfig): BunHttpInstrumentationConfig => {
      const headerConfig = cfg.headersToSpanAttributes?.server || cfg.captureAttributes;
      if (headerConfig) {
        validateCaptureAttributes(headerConfig);
      }
      return cfg;
    };

    super("@opentelemetry/instrumentation-bun-http", "0.1.0", "http", config, [
      migrateToCaptureAttributes((cfg: BunHttpInstrumentationConfig) => cfg?.headersToSpanAttributes?.server),
      validate,
    ]);
  }

  /**
   * Override cleanup hook to also remove metric attributes on error.
   */
  protected onErrorCleanup(id: number): void {
    this._activeMetricAttributes.delete(id);
  }

  /**
   * Override enable to check for disableIncomingRequestInstrumentation.
   */
  enable(): void {
    // Check if instrumentation is disabled
    if (this._config.disableIncomingRequestInstrumentation) {
      return;
    }

    // Delegate to base class
    super.enable();
  }

  /**
   * Customize the native instrument definition with HTTP server-specific hooks.
   */
  protected _customizeNativeInstrument(instrument: Bun.NativeInstrument): Bun.NativeInstrument {
    // Extract header configuration with defaults matching Zig config.zig defaults
    // Default request headers: content-type, user-agent, accept, content-length
    // Default response headers: content-type, content-length
    const requestHeaders = this._config.headersToSpanAttributes?.server?.requestHeaders ||
      this._config.captureAttributes?.requestHeaders || ["content-type", "user-agent", "accept", "content-length"];
    const responseHeaders = this._config.headersToSpanAttributes?.server?.responseHeaders ||
      this._config.captureAttributes?.responseHeaders || ["content-type", "content-length"];
    const tracer = this.getTracer();

    return {
      ...instrument,
      type: "http",
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
        response: [TRACEPARENT, TRACESTATE],
      },

      onOperationStart: (id: OpId, attributes: Record<string, any>) => {
        // Check if request should be ignored
        if (this._config.ignoreIncomingRequestHook) {
          // Create mock IncomingMessage for hook
          const mockRequest = { url: attributes["url.path"] } as IncomingMessage;
          if (this._config.ignoreIncomingRequestHook(mockRequest)) {
            return;
          }
        }

        // Extract span name from HTTP method and path
        const method = attributes[ATTR_HTTP_REQUEST_METHOD] || "HTTP";
        const route = attributes["http.route"] || attributes["url.path"] || "/";
        const spanName = `${method} ${route}`;

        // Extract parent context if traceparent header present
        let parentContext = context.active();
        if (attributes["trace.parent.trace_id"] && attributes["trace.parent.span_id"]) {
          // Native Zig layer has already parsed traceparent header
          const traceId = attributes["trace.parent.trace_id"];
          const spanId = attributes["trace.parent.span_id"];
          const flags = attributes["trace.parent.trace_flags"] || 0;
          const reconstructed = `00-${traceId}-${spanId}-${flags.toString(16).padStart(2, "0")}`;
          parentContext = propagation.extract(context.active(), attributes, {
            get: (carrier, key) => {
              // Map OTel attribute names back to headers for propagator
              if (key === "traceparent") {
                return reconstructed;
              }
              if (key === "tracestate") {
                return carrier["trace.parent.trace_state"];
              }
              return undefined;
            },
            keys: () => ["traceparent", "tracestate"],
          });
        }

        // Check if parent is required
        if (this._config.requireParentforIncomingSpans && parentContext === context.active()) {
          // No parent context found, skip span creation
          return;
        }

        // Build initial span attributes
        const spanAttributes: Attributes = {
          [ATTR_HTTP_REQUEST_METHOD]: attributes[ATTR_HTTP_REQUEST_METHOD],
          [ATTR_URL_PATH]: attributes[ATTR_URL_PATH],
          [ATTR_URL_QUERY]: attributes[ATTR_URL_QUERY],
          [ATTR_URL_SCHEME]: attributes[ATTR_URL_SCHEME],
          [ATTR_SERVER_ADDRESS]: this._config.serverName || attributes[ATTR_SERVER_ADDRESS],
          [ATTR_SERVER_PORT]: attributes[ATTR_SERVER_PORT],
        };

        // Add http.route if available
        if (attributes["http.route"]) {
          spanAttributes["http.route"] = attributes["http.route"];
        }

        // Call startIncomingSpanHook if provided
        if (this._config.startIncomingSpanHook) {
          const mockRequest = { url: attributes["url.path"] } as IncomingMessage;
          const customAttributes = this._config.startIncomingSpanHook(mockRequest);
          Object.assign(spanAttributes, customAttributes);
        }

        // Create SERVER span with parent context
        const span = tracer.startSpan(
          spanName,
          {
            kind: SpanKind.SERVER,
            attributes: spanAttributes,
          },
          parentContext,
        );

        // Add captured request headers if configured
        if (requestHeaders) {
          for (const headerName of requestHeaders) {
            const attrKey = ATTR_HTTP_REQUEST_HEADER(headerName);
            if (attributes[attrKey] !== undefined) {
              span.setAttribute(attrKey, attributes[attrKey]);
            }
          }
        }

        // Call requestHook if provided
        if (this._config.requestHook) {
          const mockRequest = { url: attributes["url.path"] } as IncomingMessage;
          this._config.requestHook(span, mockRequest);
        }

        // Store span for later retrieval (use direct access since we created span with custom parent context)
        this._activeSpans.set(id, span);

        // Store metric attributes for later use (subset of span attributes for cardinality control)
        // These will be augmented with response attributes when the request completes
        const metricAttributes: Record<string, any> = {
          [ATTR_HTTP_REQUEST_METHOD]: spanAttributes[ATTR_HTTP_REQUEST_METHOD],
          [ATTR_URL_PATH]: spanAttributes[ATTR_URL_PATH],
        };

        // Add http.route if available (important for cardinality)
        if (spanAttributes[ATTR_HTTP_ROUTE]) {
          metricAttributes[ATTR_HTTP_ROUTE] = spanAttributes[ATTR_HTTP_ROUTE];
        }

        // Add server.address and server.port if available
        if (spanAttributes["server.address"]) {
          metricAttributes["server.address"] = spanAttributes["server.address"];
        }
        if (spanAttributes["server.port"]) {
          metricAttributes["server.port"] = spanAttributes["server.port"];
        }

        this._activeMetricAttributes.set(id, metricAttributes);

        // Update AsyncLocalStorage frame with span context
        // This makes the span available via context.active() for downstream calls (e.g., fetch)
        if (this._contextStorage) {
          const spanContext = trace.setSpan(parentContext, span);
          this._contextStorage.enterWith(spanContext);
        }
      },

      onOperationProgress: (id: number, attributes: Record<string, any>) => {
        const span = this._internalSpanGet(id);
        if (!span) {
          return;
        }

        // Add captured response headers (sent early by Zig layer before request completes)
        if (responseHeaders) {
          for (const headerName of responseHeaders) {
            const attrKey = `http.response.header.${headerName}`;
            if (attributes[attrKey] !== undefined) {
              span.setAttribute(attrKey, attributes[attrKey]);
            }
          }
        }

        // Note: Do NOT end the span here - onOperationEnd will handle that
      },

      onOperationEnd: (id: number, attributes: Record<string, any>) => {
        const span = this._internalSpanGet(id);
        if (!span) {
          return;
        }

        // Update span with response attributes
        span.setAttributes({
          "http.response.status_code": attributes["http.response.status_code"],
        });

        // Add response body size if available
        if (attributes["http.response.body.size"] !== undefined) {
          span.setAttribute("http.response.body.size", attributes["http.response.body.size"]);
        }

        // Note: Response headers are added in onOperationProgress, not here

        // Call responseHook if provided
        if (this._config.responseHook) {
          const mockResponse = {
            statusCode: attributes["http.response.status_code"],
          } as ServerResponse;
          this._config.responseHook(span, mockResponse);
        }

        // Call applyCustomAttributesOnSpan if provided
        if (this._config.applyCustomAttributesOnSpan) {
          const mockRequest = { url: attributes["url.path"] } as IncomingMessage;
          const mockResponse = {
            statusCode: attributes["http.response.status_code"],
          } as ServerResponse;
          this._config.applyCustomAttributesOnSpan(span, mockRequest, mockResponse);
        }

        // Set span status based on HTTP status code (for SERVER spans, >=500 is error)
        this.setStatusCodeFromHttpStatus(attributes, span, statusCode => statusCode >= 500);

        // Record metrics if meter provider is configured
        // Zig provides operation.duration in nanoseconds
        if (attributes["operation.duration"] !== undefined) {
          this.recordOperationMetrics(id, attributes["operation.duration"], attributes, ["http.response.status_code"]);
        }

        // End span and cleanup
        this._internalSpanEnd(id, span);
        this._activeMetricAttributes.delete(id);
      },

      onOperationError: (id: number, attributes: Record<string, any>) => this.handleOperationError(id, attributes),

      onOperationInject: (id: OpId) => this.generateTraceHeaders(id),
    };
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

    // Counter: http.server.requests.total
    this._httpServerRequestsCounter = meter.createCounter("http.server.requests.total", {
      description: "Total number of HTTP requests received by the server.",
      unit: "1",
    });
  }
}
