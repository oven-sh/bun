/**
 * Shared configuration types for Bun OpenTelemetry instrumentations.
 *
 * @module bun-otel/instruments/config
 */

import type { Attributes, Context as OtelContext, Span } from "@opentelemetry/api";
import type { InstrumentationConfig } from "@opentelemetry/instrumentation";
import type { AsyncLocalStorage } from "async_hooks";
import type { IncomingMessage, ServerResponse } from "http";

/**
 * Base configuration shared across all Bun instrumentations.
 */
export interface BunInstrumentationConfig extends InstrumentationConfig {
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
   * Map HTTP headers to span attributes.
   * Compatible with Node.js SDK format for migration purposes.
   *
   * For Bun.serve and node:http server, use:
   * ```typescript
   * headersToSpanAttributes: {
   *   server: { requestHeaders: [...], responseHeaders: [...] }
   * }
   * ```
   *
   * For fetch() client, use:
   * ```typescript
   * headersToSpanAttributes: {
   *   requestHeaders: [...], responseHeaders: [...]
   * }
   * ```
   *
   * @deprecated Use captureAttributes instead
   * @internal
   */
  headersToSpanAttributes?:
    | {
        // Server format (Bun.serve, node:http)
        server?: {
          requestHeaders?: string[];
          responseHeaders?: string[];
        };
      }
    | {
        // Client format (fetch)
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
 * Extended configuration for HTTP server instrumentations (Bun.serve, node:http).
 * Includes additional hooks for request filtering and custom attributes.
 */
export interface BunHttpInstrumentationConfig extends BunInstrumentationConfig {
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
   * Enable automatic population of synthetic source type based on user-agent header.
   * @experimental
   * @default false
   */
  enableSyntheticSourceDetection?: boolean;
}
