/**
 * OpenTelemetry instrumentation for Bun's native fetch() client.
 *
 * This instrumentation uses Bun's native telemetry hooks (Bun.telemetry.attach)
 * to create CLIENT spans for all outbound fetch requests, automatically injecting
 * W3C TraceContext headers for distributed tracing.
 *
 * @module bun-otel/instruments/BunFetchInstrumentation
 */

import { SpanKind, type Context as OtelContext } from "@opentelemetry/api";
import type { InstrumentationConfig } from "@opentelemetry/instrumentation";
import { ATTR_HTTP_RESPONSE_BODY_SIZE } from "@opentelemetry/semantic-conventions/incubating";
import { AsyncLocalStorage } from "async_hooks";
import { OpId } from "bun";
import {
  ATTR_URL_SCHEME,
  ATTR_HTTP_REQUEST_HEADER,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_HEADER,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_FULL,
  HTTP_REQUEST_METHOD_VALUE_GET,
  TRACEPARENT,
  TRACESTATE,
} from "../semconv";
import { migrateToCaptureAttributes } from "../validation";
import { BunAbstractInstrumentation } from "./BunAbstractInstrumentation";

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
   * Map the following HTTP headers to span attributes.
   * @see https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/instrumentation-undici/src/types.ts#L83
   */
  headersToSpanAttributes?: {
    requestHeaders?: string[];
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
export class BunFetchInstrumentation extends BunAbstractInstrumentation<BunFetchInstrumentationConfig> {
  // private _tracerProvider?: TracerProvider;
  // private _instrumentId?: InstrumentRef;

  constructor(config: BunFetchInstrumentationConfig = {}) {
    super("@opentelemetry/instrumentation-bun-fetch", "0.1.0", "fetch", config, [
      migrateToCaptureAttributes((cfg: BunFetchInstrumentationConfig) => cfg.headersToSpanAttributes),
    ]);
  }
  _customizeNativeInstrument(instrument: Bun.NativeInstrument): Bun.NativeInstrument {
    // pre-map response header attributes to capture
    const requestHeaderAttributesToCapture = (this._config.captureAttributes?.requestHeaders || []).map(
      ATTR_HTTP_REQUEST_HEADER,
    );
    const responseHeaderAttributesToCapture = (this._config.captureAttributes?.responseHeaders || []).map(
      ATTR_HTTP_RESPONSE_HEADER,
    );
    const tracer = this.getTracer();

    return {
      ...instrument,
      type: "fetch",
      name: this.instrumentationName,
      version: this.instrumentationVersion,
      captureAttributes: this._config.captureAttributes, // pass through captureAttributes so zig knows what to send!
      injectHeaders: {
        request: [TRACEPARENT, TRACESTATE],
      },
      onOperationStart: (id: OpId, attributes: Record<string, any>) => {
        // Per OTel v1.23.0: HTTP client span names should be just the method (low cardinality)
        // Incorrect: "GET https://api.example.com" (high cardinality, causes metric explosions)
        // Correct: "GET" (low cardinality, URL captured in attributes)
        const method = attributes[ATTR_HTTP_REQUEST_METHOD] || HTTP_REQUEST_METHOD_VALUE_GET;
        const spanName = method.split(" ")[0] || HTTP_REQUEST_METHOD_VALUE_GET; // in case method includes extra info

        // Create CLIENT span as child of active context
        const span = this._internalSpanStart(id, spanName, {
          kind: SpanKind.CLIENT,
          attributes: {},
        });

        this.maybeCopyAttributes(
          attributes,
          span,
          ATTR_HTTP_REQUEST_METHOD,
          ATTR_URL_FULL,
          ATTR_URL_SCHEME,
          ATTR_SERVER_ADDRESS,
          ATTR_SERVER_PORT,
          ...requestHeaderAttributesToCapture,
        );

        // NOTE: We do NOT call enterWith() for CLIENT spans because:
        // 1. The span is already created with the correct parent (activeContext)
        // 2. Calling enterWith() would overwrite the parent context (e.g., SERVER span)
        // 3. This would break nested fetch calls and async generators
        // The CLIENT span will still be exported correctly because it's stored in _activeSpans
      },

      onOperationEnd: (id: OpId, attributes: Record<string, any>) => {
        const span = this._internalSpanGet(id);
        if (!span) {
          return;
        }
        // Set span status based on HTTP status code (for CLIENT spans, >=400 is error)
        this.setStatusCodeFromHttpStatus(attributes, span, statusCode => statusCode >= 400);

        this.maybeCopyAttributes(
          attributes,
          span,
          ATTR_HTTP_RESPONSE_STATUS_CODE,
          ATTR_HTTP_RESPONSE_BODY_SIZE,
          ...responseHeaderAttributesToCapture,
        );

        // end and delete
        this._internalSpanEnd(id, span);
      },

      onOperationError: (id: OpId, attributes: Record<string, any>) => this.handleOperationError(id, attributes),

      onOperationInject: (id: OpId) => this.generateTraceHeaders(id),
    };
  }
}
