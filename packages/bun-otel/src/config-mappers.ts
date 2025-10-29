/**
 * Config mappers: NodeSDK-style config → BunGenericInstrumentationConfig
 *
 * Pure functions that map legacy OpenTelemetry config to our clean declarative format.
 * Fully testable in isolation!
 */

import { SpanKind } from "@opentelemetry/api";
import type { BunGenericInstrumentationConfig } from "./instruments/BunGenericInstrumentation";
import {
  ATTR_ERROR_TYPE,
  ATTR_EXCEPTION_MESSAGE,
  ATTR_HTTP_REQUEST_HEADER,
  ATTR_HTTP_REQUEST_HEADER_TRACEPARENT,
  ATTR_HTTP_REQUEST_HEADER_TRACESTATE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_BODY_SIZE,
  ATTR_HTTP_RESPONSE_HEADER,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_FULL,
  ATTR_URL_PATH,
  ATTR_URL_QUERY,
  ATTR_URL_SCHEME,
  HTTP_REQUEST_METHOD_VALUE_GET,
  HTTP_REQUEST_METHOD_VALUE_OTHER,
  METRIC_HTTP_SERVER_REQUEST_DURATION,
  TRACEPARENT,
  TRACESTATE,
} from "./semconv";
import { validateOptionalHeaderList } from "./validation";

/**
 * Legacy config format (from @opentelemetry/instrumentation-http)
 */
export interface LegacyHttpConfig {
  /** Enable/disable instrumentation */
  enabled?: boolean;

  /** Capture headers as span attributes (new format) */
  captureAttributes?: {
    requestHeaders?: string[];
    responseHeaders?: string[];
  };

  /** Deprecated: Old format for header capture */
  headersToSpanAttributes?:
    | {
        server?: {
          requestHeaders?: string[];
          responseHeaders?: string[];
        };
        client?: {
          requestHeaders?: string[];
          responseHeaders?: string[];
        };
      }
    | {
        requestHeaders?: string[];
        responseHeaders?: string[];
      };

  /** Inject trace context headers */
  injectHeaders?:
    | {
        request?: string[];
        response?: string[];
      }
    | false;

  /** Disable incoming request instrumentation */
  disableIncomingRequestInstrumentation?: boolean;

  /** Filter incoming requests */
  ignoreIncomingRequestHook?: (req: any) => boolean;

  /** Custom attribute hooks (not mapped to generic config yet) */
  requestHook?: (span: any, req: any) => void;
  responseHook?: (span: any, res: any) => void;
  applyCustomAttributesOnSpan?: (span: any, req: any, res: any) => void;
  startIncomingSpanHook?: (req: any) => Record<string, any>;

  /** Server name for multi-tenant setups */
  serverName?: string;

  /** Require parent span for incoming requests */
  requireParentforIncomingSpans?: boolean;

  /**
   * Enable automatic population of synthetic source type based on user-agent header.
   * @experimental
   * @default false
   */
  enableSyntheticSourceDetection?: boolean;
  /** Distributed tracing config */
  distributedTracing?:
    | boolean
    | {
        server?:
          | boolean
          | {
              requestHeaderContext?: boolean | "link-only";
              responseHeaders?: boolean;
            };
        client?:
          | boolean
          | {
              requestHeaders?: boolean;
            };
      };
}

/**
 * Default headers to capture for HTTP server
 * NOTE: traceparent and tracestate are REQUIRED for distributed tracing
 */
const DEFAULT_HTTP_SERVER_REQUEST_HEADERS = ["content-type", "content-length", "user-agent", "accept"];

const DEFAULT_HTTP_SERVER_RESPONSE_HEADERS = ["content-type", "content-length"];
/**
 * Default headers to capture for fetch client
 */
const DEFAULT_FETCH_REQUEST_HEADERS = ["content-type"];
const DEFAULT_FETCH_RESPONSE_HEADERS = ["content-type"];

function validateHeadersAndMapToAttributes(params: { requestHeaders: string[]; responseHeaders: string[] }): {
  responseHeaderAttrs: string[];
  requestHeaderAttrs: string[];
} {
  const { requestHeaders, responseHeaders } = params;
  validateOptionalHeaderList(requestHeaders);
  validateOptionalHeaderList(responseHeaders);

  const requestHeaderAttrs = requestHeaders.map(ATTR_HTTP_REQUEST_HEADER);
  const responseHeaderAttrs = responseHeaders.map(ATTR_HTTP_RESPONSE_HEADER);
  return { requestHeaderAttrs, responseHeaderAttrs };
}

/**
 * Merge legacy header configs (captureAttributes + headersToSpanAttributes)
 */
function mergeHeaderConfigs(
  config: LegacyHttpConfig,
  type: "server" | "client" | "fetch",
): {
  requestHeaders: string[];
  responseHeaders: string[];
} {
  const requestHeaders = new Set<string>();
  const responseHeaders = new Set<string>();

  // New format: captureAttributes
  if (config.captureAttributes?.requestHeaders) {
    config.captureAttributes.requestHeaders.forEach(h => requestHeaders.add(h));
  }
  if (config.captureAttributes?.responseHeaders) {
    config.captureAttributes.responseHeaders.forEach(h => responseHeaders.add(h));
  }

  // Old format: headersToSpanAttributes
  const oldFormat = config.headersToSpanAttributes;
  if (oldFormat) {
    // Check if it's nested (server/client) or direct format
    if ("server" in oldFormat || "client" in oldFormat) {
      const nested = type === "server" ? oldFormat.server : oldFormat.client;
      if (nested?.requestHeaders) {
        nested.requestHeaders.forEach(h => requestHeaders.add(h));
      }
      if (nested?.responseHeaders) {
        nested.responseHeaders.forEach(h => responseHeaders.add(h));
      }
    } else if ("requestHeaders" in oldFormat || "responseHeaders" in oldFormat) {
      // Direct format (fetch)
      if (oldFormat.requestHeaders) {
        oldFormat.requestHeaders.forEach(h => requestHeaders.add(h));
      }
      if (oldFormat.responseHeaders) {
        oldFormat.responseHeaders.forEach(h => responseHeaders.add(h));
      }
    }
  }

  if (requestHeaders.size === 0) {
    if (type === "server") DEFAULT_HTTP_SERVER_REQUEST_HEADERS.forEach(h => requestHeaders.add(h));
    if (type === "fetch") DEFAULT_FETCH_REQUEST_HEADERS.forEach(h => requestHeaders.add(h));
  }
  if (responseHeaders.size === 0) {
    if (type === "server") DEFAULT_HTTP_SERVER_RESPONSE_HEADERS.forEach(h => responseHeaders.add(h));
    if (type === "fetch") DEFAULT_FETCH_RESPONSE_HEADERS.forEach(h => responseHeaders.add(h));
  }
  const traceEnabled = config.distributedTracing !== false;
  if (traceEnabled && type === "server") {
    requestHeaders.add(TRACEPARENT);
    requestHeaders.add(TRACESTATE);
  }

  return {
    requestHeaders: Array.from(requestHeaders),
    responseHeaders: Array.from(responseHeaders),
  };
}

/**
 * Map HTTP server attributes to semantic convention names
 */
function mapHttpServerAttributes(headers: { requestHeaders: string[]; responseHeaders: string[] }): {
  start: string[];
  update: string[];
  end: string[];
} {
  const { requestHeaderAttrs, responseHeaderAttrs } = validateHeadersAndMapToAttributes(headers);

  return {
    start: [
      ATTR_HTTP_REQUEST_METHOD, //"http.request.method",
      ATTR_URL_PATH, // "url.path",
      ATTR_URL_QUERY, // "url.query",
      ATTR_URL_SCHEME, // "url.scheme",
      ATTR_SERVER_ADDRESS, // "server.address",
      ATTR_SERVER_PORT, // "server.port",
      ATTR_HTTP_ROUTE, // "http.route",
      ...requestHeaderAttrs,
    ],
    update: responseHeaderAttrs,
    end: [ATTR_HTTP_RESPONSE_STATUS_CODE, ATTR_HTTP_RESPONSE_BODY_SIZE],
  };
}

/**
 * Map fetch client attributes to semantic convention names
 */
function mapFetchClientAttributes(headers: { requestHeaders: string[]; responseHeaders: string[] }): {
  start: string[];
  end: string[];
} {
  const { requestHeaderAttrs, responseHeaderAttrs } = validateHeadersAndMapToAttributes(headers);

  return {
    start: [
      ATTR_HTTP_REQUEST_METHOD, //"http.request.method",
      ATTR_URL_FULL, // "url.full",
      ATTR_URL_SCHEME, // "url.scheme",
      ATTR_SERVER_ADDRESS, // "server.address",
      ATTR_SERVER_PORT, // "server.port",
      ...requestHeaderAttrs,
    ],
    end: [
      ATTR_HTTP_RESPONSE_STATUS_CODE, // "http.response.status_code",
      ATTR_HTTP_RESPONSE_BODY_SIZE, // "http.response.body.size",
      ...responseHeaderAttrs,
    ],
  };
}

/**
 * Map legacy HTTP server config to BunGenericInstrumentationConfig
 */
export function mapHttpServerConfig(config: LegacyHttpConfig = {}): BunGenericInstrumentationConfig {
  // Merge header configs with defaults
  const headers = mergeHeaderConfigs(config, "server");
  validateHeadersAndMapToAttributes(headers);

  const attrs = mapHttpServerAttributes(headers);
  return {
    name: "http.server",
    version: "0.1.0",
    kind: "http",
    enabled: config.enabled ?? true,

    // SERVER spans update AsyncLocalStorage
    setsAsyncStorageContext: true,

    // Trace config
    trace: {
      start: attrs.start,
      update: attrs.update,
      end: attrs.end,
      err: [ATTR_ERROR_TYPE, ATTR_EXCEPTION_MESSAGE],
    },

    // Metrics config
    metrics: {
      start: [ATTR_HTTP_REQUEST_METHOD, ATTR_URL_PATH, ATTR_HTTP_ROUTE, ATTR_SERVER_ADDRESS, ATTR_SERVER_PORT],
      end: [ATTR_HTTP_RESPONSE_STATUS_CODE],
    },

    // Metric instruments
    metricInstruments: {
      counter: {
        name: "http.server.requests.total",
        description: "Total number of HTTP requests received by the server.",
      },
      histogram: {
        name: METRIC_HTTP_SERVER_REQUEST_DURATION,
        description: "Duration of HTTP server requests",
        unit: "s",
        buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
      },
    },

    // Native provides duration
    nativeDuration: "end",

    // Extract parent context from request headers
    extractParentContext: attrs => ({
      traceparent: attrs[ATTR_HTTP_REQUEST_HEADER_TRACEPARENT],
      tracestate: attrs[ATTR_HTTP_REQUEST_HEADER_TRACESTATE],
    }),

    // Span name: "GET /users"
    extractSpanName: attrs => {
      const method = attrs[ATTR_HTTP_REQUEST_METHOD] || "HTTP";
      const route = attrs[ATTR_HTTP_ROUTE] || attrs[ATTR_URL_PATH] || "/";
      return `${method} ${route}`;
    },

    // SERVER span
    extractSpanKind: () => SpanKind.SERVER,

    // 5xx is error for servers
    isError: attrs => {
      const statusCode = attrs[ATTR_HTTP_RESPONSE_STATUS_CODE];
      return typeof statusCode === "number" && statusCode >= 500;
    },
  };
}

/**
 * Map legacy Node.js HTTP server config to BunGenericInstrumentationConfig
 */
export function mapNodeHttpServerConfig(config: LegacyHttpConfig = {}): BunGenericInstrumentationConfig {
  // Node HTTP server is similar to Bun HTTP server, but:
  // 1. No onOperationProgress (no update phase)
  // 2. No native duration tracking (track internally)

  const headers = mergeHeaderConfigs(config, "server");
  const { requestHeaderAttrs, responseHeaderAttrs } = validateHeadersAndMapToAttributes(headers);

  return {
    name: "http.server",
    version: "0.1.0",
    kind: "node",
    enabled: config.enabled ?? true,

    setsAsyncStorageContext: true,

    trace: {
      start: [
        ATTR_HTTP_REQUEST_METHOD, //"http.request.method",
        ATTR_URL_PATH, // "url.path",
        ATTR_URL_SCHEME, // "url.scheme",
        ATTR_SERVER_ADDRESS, //  "server.address",
        ATTR_SERVER_PORT, //  "server.port",
        ...requestHeaderAttrs,
      ],
      // No update phase for Node HTTP
      end: [
        ATTR_HTTP_RESPONSE_STATUS_CODE, //"http.response.status_code",
        ATTR_HTTP_RESPONSE_BODY_SIZE, //"http.response.body.size",
        ...responseHeaderAttrs,
      ],
      err: [
        ATTR_ERROR_TYPE, // "error.type",
        ATTR_EXCEPTION_MESSAGE, // "exception.message",
      ],
    },

    metrics: {
      end: [
        ATTR_HTTP_REQUEST_METHOD, // "http.request.method",
        ATTR_URL_PATH, // "url.path",
        ATTR_HTTP_RESPONSE_STATUS_CODE, // "http.response.status_code"
      ],
    },

    // Metric instruments
    metricInstruments: {
      counter: {
        name: "http.server.requests.total", // todo - semconv?
        description: "Total number of HTTP requests received by the server.",
      },
      histogram: {
        name: METRIC_HTTP_SERVER_REQUEST_DURATION, // "http.server.request.duration",
        description: "Duration of HTTP server requests",
        unit: "s",
        buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
      },
    },

    // Node doesn't provide native duration - track internally
    nativeDuration: undefined,

    extractParentContext: attrs => ({
      traceparent: attrs[ATTR_HTTP_REQUEST_HEADER_TRACEPARENT],
      tracestate: attrs[ATTR_HTTP_REQUEST_HEADER_TRACESTATE],
    }),

    extractSpanName: attrs => {
      const method = attrs[ATTR_HTTP_REQUEST_METHOD] || HTTP_REQUEST_METHOD_VALUE_OTHER;
      const path = attrs[ATTR_URL_PATH] || "/";
      return `${method} ${path}`;
    },

    extractSpanKind: () => SpanKind.SERVER,

    isError: attrs => {
      const statusCode = attrs[ATTR_HTTP_RESPONSE_STATUS_CODE];
      return typeof statusCode === "number" && statusCode >= 500;
    },
  };
}
/**
 * Map legacy fetch client config to BunGenericInstrumentationConfig
 */
export function mapFetchClientConfig(config: LegacyHttpConfig = {}): BunGenericInstrumentationConfig {
  // Merge header configs with defaults
  const headers = mergeHeaderConfigs(config, "fetch");
  if (headers.requestHeaders.length === 0) {
    headers.requestHeaders = DEFAULT_FETCH_REQUEST_HEADERS;
  }
  if (headers.responseHeaders.length === 0) {
    headers.responseHeaders = DEFAULT_FETCH_RESPONSE_HEADERS;
  }

  const attrs = mapFetchClientAttributes(headers);

  return {
    name: "http.client",
    version: "0.1.0",
    kind: "fetch",
    enabled: config.enabled ?? true,

    // CLIENT spans don't update context (would overwrite server span)
    setsAsyncStorageContext: false,

    // Trace config
    trace: {
      start: attrs.start,
      end: attrs.end,
      err: [ATTR_ERROR_TYPE, ATTR_EXCEPTION_MESSAGE],
    },

    // Metrics config
    metrics: {
      end: [ATTR_HTTP_REQUEST_METHOD, ATTR_SERVER_ADDRESS, ATTR_HTTP_RESPONSE_STATUS_CODE],
    },

    // Metric instruments
    metricInstruments: {
      counter: {
        name: "http.client.request.count",
        description: "Number of HTTP client requests",
      },
      histogram: {
        name: "http.client.request.duration",
        description: "Duration of HTTP client requests",
        unit: "s",
        buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
      },
    },

    // Track duration internally (fetch is fast, no native timing yet)
    nativeDuration: undefined,

    // Span name: Just method (low cardinality)
    extractSpanName: attrs => {
      const method = attrs[ATTR_HTTP_REQUEST_METHOD] || HTTP_REQUEST_METHOD_VALUE_GET;
      return method.split(" ")[0] || "GET"; // In case method has extra info
    },

    // CLIENT span
    extractSpanKind: () => SpanKind.CLIENT,

    // 4xx and 5xx are errors for clients
    isError: attrs => {
      const statusCode = attrs[ATTR_HTTP_RESPONSE_STATUS_CODE];
      return typeof statusCode === "number" && statusCode >= 400;
    },
  };
}

/**
 * Main mapper: Takes NodeSDK-style config, returns all instrument configs
 */
export interface NodeSDKConfig {
  http?: LegacyHttpConfig;
  fetch?: LegacyHttpConfig;
  node?: LegacyHttpConfig;
}

export interface MappedInstrumentConfigs {
  http: BunGenericInstrumentationConfig;
  fetch: BunGenericInstrumentationConfig;
  node: BunGenericInstrumentationConfig;
}

/**
 * Map NodeSDK config to clean instrument configs
 *
 * @example
 * ```typescript
 * const sdkConfig = {
 *   http: {
 *     captureAttributes: {
 *       requestHeaders: ["user-agent"],
 *     },
 *   },
 * };
 *
 * const configs = mapNodeSDKConfig(sdkConfig);
 * // → { http: {...}, fetch: {...}, node: {...} }
 * ```
 */
export function mapNodeSDKConfig(config: NodeSDKConfig = {}): MappedInstrumentConfigs {
  return {
    http: mapHttpServerConfig(config.http),
    fetch: mapFetchClientConfig(config.fetch),
    node: mapNodeHttpServerConfig(config.node),
  };
}
