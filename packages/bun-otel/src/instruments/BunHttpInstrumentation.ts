/**
 * OpenTelemetry instrumentation for Bun's HTTP servers (Bun.serve and Node.js http.Server).
 *
 * This instrumentation uses Bun's native telemetry hooks (Bun.telemetry.attach)
 * to create SERVER spans for all incoming HTTP requests, automatically extracting
 * W3C TraceContext headers for distributed tracing.
 *
 * Supports both:
 * - Native Bun.serve() - spans managed via onOperationStart/End/Error hooks
 * - Node.js http.createServer() - spans managed via .once() listeners on ServerResponse
 *
 * @module bun-otel/instruments/BunHttpInstrumentation
 */

import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  type MeterProvider,
  type Span,
  type TracerProvider,
} from "@opentelemetry/api";
import type { Instrumentation, InstrumentationConfig } from "@opentelemetry/instrumentation";
import { InstrumentRef, OpId } from "bun";
import { InstrumentKind } from "../../types";

import { validateCaptureAttributes } from "../validation";
import { IncomingMessage, ServerResponse } from "http";

// Symbols for Node.js http.Server span tracking
const kSpan = Symbol("kOtelSpan");

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
 * OpenTelemetry instrumentation for Bun HTTP servers (Bun.serve and Node.js http.Server).
 *
 * Unlike Node.js instrumentations that use monkey-patching via InstrumentationBase,
 * this implementation uses Bun's native telemetry hooks for zero-overhead instrumentation.
 *
 * Key features:
 * - Creates SERVER spans for all incoming HTTP requests (both Bun.serve and http.createServer)
 * - Automatically extracts trace context from traceparent header
 * - Maps native attributes to OTel semantic conventions v1.23.0+
 * - Handles errors and HTTP error status codes
 * - Supports HTTP route patterns when available
 * - Node.js http.Server support via .once() listeners for deferred attributes
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
 *
 * // AND all Node.js http.createServer() requests will be traced
 * import http from 'node:http';
 * http.createServer((req, res) => {
 *   res.end('Hello from Node.js http!');
 * }).listen(3001);
 * ```
 */
export class BunHttpInstrumentation implements Instrumentation<BunHttpInstrumentationConfig> {
  readonly instrumentationName = "@opentelemetry/instrumentation-bun-http";
  readonly instrumentationVersion = "0.1.0";

  private _config: BunHttpInstrumentationConfig;
  private _tracerProvider?: TracerProvider;
  private _instrumentId?: InstrumentRef;
  private _activeSpans: Map<number, Span> = new Map();

  constructor(config: BunHttpInstrumentationConfig = {}) {
    this._config = { enabled: true, ...config };

    // Validate configuration at construction time
    if (this._config.captureAttributes) {
      validateCaptureAttributes(this._config.captureAttributes);
    }
  }

  /**
   * Check if attributes contain Node.js request/response objects.
   * Used to differentiate between Bun.serve and Node.js http.Server requests.
   */
  private isNodeAttributes(attributes: Record<string, any>): attributes is {
    http_req: IncomingMessage;
    http_res: ServerResponse;
  } {
    return Boolean(
      attributes["http_req"] &&
        attributes["http_res"] &&
        typeof attributes["http_req"] === "object" &&
        typeof attributes["http_res"] === "object",
    );
  }

  /**
   * Extract content-length from a ServerResponse.
   * Handles both number and string values from getHeader().
   */
  private extractContentLength(response: ServerResponse): number {
    const contentLength = response.getHeader("content-length");

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
   * and handle span lifecycle. Adapted from POC implementation.
   */
  private setupNodeJsResponseListeners(id: OpId, span: Span, req: IncomingMessage, res: ServerResponse): void {
    // Store span on response object for handleWriteHead hook
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
        this._activeSpans.delete(id);
      }
    });
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

      onOperationStart: (id: OpId, attributes: Record<string, any>) => {
        // Extract span name from HTTP method and path
        const method = attributes["http.request.method"] || "HTTP";
        const route = attributes["http.route"] || attributes["url.path"] || "/";
        const spanName = `${method} ${route}`;

        // Check if this is a Node.js http.Server request (has IncomingMessage/ServerResponse objects)
        const isNodeJsRequest = this.isNodeAttributes(attributes);
        const nodeRequest = attributes["http_req"] as IncomingMessage | undefined;
        const nodeResponse = attributes["http_res"] as ServerResponse | undefined;

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

        // For Node.js http.Server requests, setup .once() listeners to capture response attributes
        // This handles deferred attributes (status code, headers) that aren't available at request start
        if (isNodeJsRequest && nodeRequest && nodeResponse) {
          this.setupNodeJsResponseListeners(id, span, nodeRequest, nodeResponse);
        }
      },

      onOperationEnd: (id: number, attributes: Record<string, any>) => {
        const span = this._activeSpans.get(id);
        if (!span) {
          return;
        }

        // For Node.js http.Server requests, the .once() listeners handle span lifecycle
        // Skip processing here to avoid duplicate span.end() calls
        if (this.isNodeAttributes(attributes)) {
          return;
        }

        // Update span with response attributes (Bun.serve only)
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

        // For Node.js http.Server requests, the .once() listeners handle errors
        // Skip processing here to avoid duplicate error recording
        if (this.isNodeAttributes(attributes)) {
          return;
        }

        // Record exception on span (Bun.serve only)
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

      onOperationInject: (id: OpId, _data?: unknown) => {
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

        // Return array matching injectHeaders.response order: ["traceparent", "tracestate"]
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
