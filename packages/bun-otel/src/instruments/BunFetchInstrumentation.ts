/**
 * OpenTelemetry instrumentation for Bun's native fetch() client.
 *
 * This instrumentation uses Bun's native telemetry hooks (Bun.telemetry.attach)
 * to create CLIENT spans for all outbound fetch requests, automatically injecting
 * W3C TraceContext headers for distributed tracing.
 *
 * @module bun-otel/instruments/BunFetchInstrumentation
 */

import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type MeterProvider,
  type Context as OtelContext,
  type Span,
  type TracerProvider,
} from "@opentelemetry/api";
import type { Instrumentation, InstrumentationConfig } from "@opentelemetry/instrumentation";
import { AsyncLocalStorage } from "async_hooks";
import { InstrumentRef } from "bun";
import { InstrumentKind } from "../../types";
import { validateCaptureAttributes } from "../validation";

/**
 * Configuration options for BunFetchInstrumentation.
 */
export interface BunFetchInstrumentationConfig extends InstrumentationConfig {
  /**
   * HTTP headers to capture as span attributes.
   * Sensitive headers (authorization, cookie, etc.) are always blocked.
   */
  captureAttributes?: {
    /** Request headers to capture (e.g., ["content-type", "accept"]) */
    requestHeaders?: string[];
    /** Response headers to capture (e.g., ["content-type", "cache-control"]) */
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
 * OpenTelemetry instrumentation for Bun's native fetch() API.
 *
 * Unlike Node.js instrumentations that use monkey-patching via InstrumentationBase,
 * this implementation uses Bun's native telemetry hooks for zero-overhead instrumentation.
 *
 * Key features:
 * - Creates CLIENT spans for all fetch requests
 * - Automatically propagates trace context via traceparent header
 * - Maps native attributes to OTel semantic conventions v1.23.0+
 * - Handles errors and HTTP error status codes
 *
 * @example
 * ```typescript
 * import { BunFetchInstrumentation } from 'bun-otel';
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 *
 * const provider = new NodeTracerProvider();
 * const instrumentation = new BunFetchInstrumentation({
 *   captureAttributes: {
 *     requestHeaders: ['content-type'],
 *     responseHeaders: ['content-type', 'cache-control'],
 *   },
 * });
 *
 * instrumentation.setTracerProvider(provider);
 * instrumentation.enable();
 * ```
 */
export class BunFetchInstrumentation implements Instrumentation<BunFetchInstrumentationConfig> {
  readonly instrumentationName = "@opentelemetry/instrumentation-bun-fetch";
  readonly instrumentationVersion = "0.1.0";

  private _config: BunFetchInstrumentationConfig;
  private _tracerProvider?: TracerProvider;
  private _instrumentId?: InstrumentRef;
  private _activeSpans: Map<number, Span> = new Map();

  constructor(config: BunFetchInstrumentationConfig = {}) {
    // Per OpenTelemetry spec: enabled defaults to FALSE in constructor
    // registerInstrumentations() will call enable() after setting TracerProvider
    this._config = { enabled: false, ...config };

    // Validate configuration at construction time
    if (this._config.captureAttributes) {
      validateCaptureAttributes(this._config.captureAttributes);
    }
  }

  /**
   * Enable instrumentation by attaching to Bun's native telemetry hooks.
   * Creates CLIENT spans for all outbound fetch requests.
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

    // Attach to Bun's native fetch hooks
    this._instrumentId = Bun.telemetry.attach({
      type: "fetch",
      name: this.instrumentationName,
      version: this.instrumentationVersion,
      captureAttributes: this._config.captureAttributes,
      injectHeaders: {
        request: ["traceparent", "tracestate"],
      },

      onOperationStart: (id: number, attributes: Record<string, any>) => {
        // Per OTel v1.23.0: HTTP client span names should be just the method (low cardinality)
        // Incorrect: "GET https://api.example.com" (high cardinality, causes metric explosions)
        // Correct: "GET" (low cardinality, URL captured in attributes)
        const method = attributes["http.request.method"] || "GET";
        const spanName = method;

        // Get active context (may contain SERVER span from BunHttpInstrumentation)
        const activeContext = context.active();

        // Create CLIENT span as child of active context
        const span = tracer.startSpan(
          spanName,
          {
            kind: SpanKind.CLIENT,
            attributes: {
              // Map native attributes to OTel semantic conventions
              "http.request.method": attributes["http.request.method"],
              "url.full": attributes["url.full"],
              "server.address": attributes["server.address"],
              "server.port": attributes["server.port"],
              "url.scheme": attributes["url.scheme"],
              ...attributes,
            },
          },
          activeContext,
        );

        // Add captured request headers if configured
        // if (this._config.captureAttributes?.requestHeaders) {
        //   for (const headerName of this._config.captureAttributes.requestHeaders) {
        //     const attrKey = `http.request.header.${headerName}`;
        //     if (attributes[attrKey] !== undefined) {
        //       span.setAttribute(attrKey, attributes[attrKey]);
        //     }
        //   }
        // }

        // Store span for later retrieval
        this._activeSpans.set(id, span);

        // NOTE: We do NOT call enterWith() for CLIENT spans because:
        // 1. The span is already created with the correct parent (activeContext)
        // 2. Calling enterWith() would overwrite the parent context (e.g., SERVER span)
        // 3. This would break nested fetch calls and async generators
        // The CLIENT span will still be exported correctly because it's stored in _activeSpans
      },

      onOperationEnd: (id: number, attributes: Record<string, any>) => {
        const span = this._activeSpans.get(id);
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

        // Add captured response headers if configured
        if (this._config.captureAttributes?.responseHeaders) {
          for (const headerName of this._config.captureAttributes.responseHeaders) {
            const attrKey = `http.response.header.${headerName}`;
            if (attributes[attrKey] !== undefined) {
              span.setAttribute(attrKey, attributes[attrKey]);
            }
          }
        }

        // Set span status based on HTTP status code
        const statusCode = attributes["http.response.status_code"];
        if (statusCode >= 400) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${statusCode}`,
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        span.setAttributes({ ...attributes });
        span.end();
        this._activeSpans.delete(id);
      },

      onOperationError: (id: number, attributes: Record<string, any>) => {
        const span = this._activeSpans.get(id);
        if (!span) {
          return;
        }

        // Record exception on span
        span.recordException({
          name: attributes["error.type"] || "Error",
          message: attributes["error.message"] || "Unknown error",
          stack: attributes["error.stack_trace"],
        });

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: attributes["error.message"] || "Request failed",
        });

        span.end();
        this._activeSpans.delete(id);
      },

      onOperationInject: (id: number, _data?: any) => {
        const span = this._activeSpans.get(id);
        if (!span) {
          return undefined;
        }

        // Construct W3C traceparent header from span context
        // Per contract: specs/001-opentelemetry-support/contracts/telemetry-http.md lines 131-138
        const spanContext = span.spanContext();
        const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16).padStart(2, "0")}`;

        // Extract tracestate if present
        const tracestate = spanContext.traceState?.serialize() || "";

        // Return array matching injectHeaders.request order: ["traceparent", "tracestate"]
        return [traceparent, tracestate];
      },
    });
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
   * Set the MeterProvider (not used for fetch instrumentation).
   */
  setMeterProvider(_meterProvider: MeterProvider): void {
    // Metrics not currently collected for fetch operations
  }

  /**
   * Update instrumentation configuration.
   * Note: Changes require disable() + enable() to take effect.
   */
  setConfig(config: BunFetchInstrumentationConfig): void {
    // Validate new configuration
    if (config.captureAttributes) {
      validateCaptureAttributes(config.captureAttributes);
    }

    this._config = { ...this._config, ...config };
  }

  /**
   * Get current instrumentation configuration.
   */
  getConfig(): BunFetchInstrumentationConfig {
    return { ...this._config };
  }

  /**
   * Implement Symbol.dispose for use with `using` declarations.
   * Automatically calls disable() when the instrumentation goes out of scope.
   */
  [Symbol.dispose](): void {
    this.disable();
  }
}
