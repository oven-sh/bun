/**
 * OpenTelemetry instrumentation for Bun's native HTTP server (Bun.serve).
 *
 * This instrumentation uses Bun's native telemetry hooks (Bun.telemetry.attach)
 * to create SERVER spans for all incoming HTTP requests, automatically extracting
 * W3C TraceContext headers for distributed tracing.
 *
 * @module bun-otel/instruments/BunHttpInstrumentation
 */

import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type MeterProvider,
  type Span,
  type TracerProvider,
} from "@opentelemetry/api";
import type { Instrumentation, InstrumentationConfig } from "@opentelemetry/instrumentation";
import { InstrumentKind } from "../../types";
import { validateCaptureAttributes } from "../validation";

/**
 * Configuration options for BunHttpInstrumentation.
 */
export interface BunHttpInstrumentationConfig extends InstrumentationConfig {
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
 * OpenTelemetry instrumentation for Bun's native HTTP server (Bun.serve).
 *
 * Unlike Node.js instrumentations that use monkey-patching via InstrumentationBase,
 * this implementation uses Bun's native telemetry hooks for zero-overhead instrumentation.
 *
 * Key features:
 * - Creates SERVER spans for all incoming HTTP requests
 * - Automatically extracts trace context from traceparent header
 * - Maps native attributes to OTel semantic conventions v1.23.0+
 * - Handles errors and HTTP error status codes
 * - Supports HTTP route patterns when available
 *
 * @example
 * ```typescript
 * import { BunHttpInstrumentation } from 'bun-otel';
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 *
 * const provider = new NodeTracerProvider();
 * const instrumentation = new BunHttpInstrumentation({
 *   captureAttributes: {
 *     requestHeaders: ['user-agent', 'content-type', 'x-request-id'],
 *     responseHeaders: ['content-type', 'x-trace-id'],
 *   },
 * });
 *
 * instrumentation.setTracerProvider(provider);
 * instrumentation.enable();
 *
 * // Now all Bun.serve() requests will be traced
 * Bun.serve({
 *   port: 3000,
 *   fetch(req) {
 *     return new Response('Hello');
 *   },
 * });
 * ```
 */
export class BunHttpInstrumentation implements Instrumentation<BunHttpInstrumentationConfig> {
  readonly instrumentationName = "@opentelemetry/instrumentation-bun-http";
  readonly instrumentationVersion = "0.1.0";

  private _config: BunHttpInstrumentationConfig;
  private _tracerProvider?: TracerProvider;
  private _instrumentId?: number;
  private _activeSpans: Map<number, Span> = new Map();

  constructor(config: BunHttpInstrumentationConfig = {}) {
    this._config = { enabled: true, ...config };

    // Validate configuration at construction time
    if (this._config.captureAttributes) {
      validateCaptureAttributes(this._config.captureAttributes);
    }
  }

  /**
   * Enable instrumentation by attaching to Bun's native telemetry hooks.
   * Creates SERVER spans for all incoming HTTP requests.
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

    // Attach to Bun's native HTTP server hooks
    this._instrumentId = Bun.telemetry.attach({
      type: InstrumentKind.HTTP,
      name: this.instrumentationName,
      version: this.instrumentationVersion,
      captureAttributes: this._config.captureAttributes,
      injectHeaders: {
        response: ["traceparent", "tracestate"],
      },

      onOperationStart: (id: number, attributes: Record<string, any>) => {
        // Extract span name from HTTP method and path
        const method = attributes["http.request.method"] || "HTTP";
        const route = attributes["http.route"] || attributes["url.path"] || "/";
        const spanName = `${method} ${route}`;

        // Extract parent context if traceparent header present
        let parentContext = context.active();
        if (attributes["trace.parent.trace_id"] && attributes["trace.parent.span_id"]) {
          // Native Zig layer has already parsed traceparent header
          // We can use this for parent span context
          // Note: This is a simplified approach - full W3C extraction happens via propagator
          parentContext = propagation.extract(context.active(), attributes, {
            get: (carrier, key) => {
              // Map OTel attribute names back to headers for propagator
              if (key === "traceparent") {
                const traceId = carrier["trace.parent.trace_id"];
                const spanId = carrier["trace.parent.span_id"];
                const flags = carrier["trace.parent.trace_flags"] || 0;
                return `00-${traceId}-${spanId}-${flags.toString(16).padStart(2, "0")}`;
              }
              if (key === "tracestate") {
                return carrier["trace.parent.trace_state"];
              }
              return undefined;
            },
            keys: () => ["traceparent", "tracestate"],
          });
        }

        // Create SERVER span with parent context
        const span = tracer.startSpan(
          spanName,
          {
            kind: SpanKind.SERVER,
            attributes: {
              // Map native attributes to OTel semantic conventions
              "http.request.method": attributes["http.request.method"],
              "url.path": attributes["url.path"],
              "url.query": attributes["url.query"],
              "url.scheme": attributes["url.scheme"],
              "server.address": attributes["server.address"],
              "server.port": attributes["server.port"],
            },
          },
          parentContext,
        );

        // Add HTTP route if available
        if (attributes["http.route"]) {
          span.setAttribute("http.route", attributes["http.route"]);
        }

        // Add captured request headers if configured
        if (this._config.captureAttributes?.requestHeaders) {
          for (const headerName of this._config.captureAttributes.requestHeaders) {
            const attrKey = `http.request.header.${headerName}`;
            if (attributes[attrKey] !== undefined) {
              span.setAttribute(attrKey, attributes[attrKey]);
            }
          }
        }

        // Store span for later retrieval
        this._activeSpans.set(id, span);
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
        if (statusCode >= 500) {
          // Server errors
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${statusCode}`,
          });
        } else if (statusCode >= 400) {
          // Client errors - not considered ERROR in server spans per OTel spec
          span.setStatus({ code: SpanStatusCode.OK });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

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

        // Inject trace context into response headers (for downstream tracing)
        const headers: Record<string, string> = {};
        context.with(trace.setSpan(context.active(), span), () => {
          propagation.inject(context.active(), headers);
        });

        return headers;
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
   * Set the MeterProvider (not used for HTTP instrumentation).
   */
  setMeterProvider(_meterProvider: MeterProvider): void {
    // Metrics not currently collected for HTTP operations
  }

  /**
   * Update instrumentation configuration.
   * Note: Changes require disable() + enable() to take effect.
   */
  setConfig(config: BunHttpInstrumentationConfig): void {
    // Validate new configuration
    if (config.captureAttributes) {
      validateCaptureAttributes(config.captureAttributes);
    }

    this._config = { ...this._config, ...config };
  }

  /**
   * Get current instrumentation configuration.
   */
  getConfig(): BunHttpInstrumentationConfig {
    return { ...this._config };
  }
}
