// Hardcoded module "internal/telemetry_http"
// Node.js HTTP server telemetry integration
//
// This module bridges Bun.telemetry's native instrumentation API with Node.js http.Server.
// It uses Bun.telemetry.nativeHooks to notify instruments managed in the native registry.
//
// Flow:
// 1. User calls Bun.telemetry.attach({ type: InstrumentKind.HTTP, ... })
// 2. Zig validates and stores instrument in native registry
// 3. _http_server.ts calls handleIncomingRequest() and handleWriteHead()
// 4. This module builds attribute objects and uses nativeHooks to notify all registered instruments

import type { IncomingMessage, ServerResponse } from "node:http";

// Access native telemetry hooks (exposed from Zig via BunObject.cpp)
const nativeHooks = Bun.telemetry.nativeHooks;
const HTTP_KIND = 1; // InstrumentKind.HTTP

// ConfigurationProperty enum values (matches telemetry.zig)
const ConfigurationProperty = {
  RESERVED: 0,
  HTTP_CAPTURE_HEADERS_SERVER_REQUEST: 1,
  HTTP_CAPTURE_HEADERS_SERVER_RESPONSE: 2,
  HTTP_PROPAGATE_HEADERS_SERVER_RESPONSE: 3,
  HTTP_CAPTURE_HEADERS_FETCH_REQUEST: 4,
  HTTP_CAPTURE_HEADERS_FETCH_RESPONSE: 5,
  HTTP_PROPAGATE_HEADERS_FETCH_REQUEST: 6,
} as const;

// Symbols for tracking request state on ServerResponse objects
const kOperationId = Symbol("kOperationId");
const kStartTime = Symbol("kStartTime");
const kHeadersEmitted = Symbol("kHeadersEmitted");

/**
 * Build request attributes from IncomingMessage (OpenTelemetry semantic conventions).
 */
function buildRequestAttributes(
  req: IncomingMessage,
  operationId: number,
  requestHeaders: string[],
): Record<string, any> {
  const attributes: Record<string, any> = {
    "operation.id": operationId,
    "operation.timestamp": Date.now() * 1_000_000, // Convert to nanoseconds
    "http.request.method": req.method || "GET",
  };

  // Parse URL components
  const url = req.url || "/";
  const host = req.headers.host || "localhost";
  const scheme = (req.socket as any).encrypted ? "https" : "http";
  const fullUrl = `${scheme}://${host}${url}`;

  const urlObj = new URL(fullUrl);
  attributes["url.full"] = fullUrl;
  attributes["url.path"] = urlObj.pathname;
  if (urlObj.search) {
    attributes["url.query"] = urlObj.search.slice(1); // Remove leading ?
  }
  attributes["url.scheme"] = scheme;
  attributes["server.address"] = urlObj.hostname;
  if (urlObj.port) {
    attributes["server.port"] = parseInt(urlObj.port, 10);
  }

  // Capture whitelisted request headers
  for (const headerName of requestHeaders) {
    const value = req.headers[headerName];
    if (value !== undefined) {
      const attrName = `http.request.header.${headerName.replace(/-/g, "_")}`;
      attributes[attrName] = $isArray(value) ? value[0] : value;
    }
  }

  // Extract distributed tracing context (traceparent header)
  const traceparent = req.headers.traceparent;
  if (traceparent && typeof traceparent === "string") {
    const parts = traceparent.split("-");
    if (parts.length === 4) {
      attributes["trace.parent.trace_id"] = parts[1];
      attributes["trace.parent.span_id"] = parts[2];
      attributes["trace.parent.trace_flags"] = parseInt(parts[3], 16);
    }
  }

  const tracestate = req.headers.tracestate;
  if (tracestate) {
    attributes["trace.parent.trace_state"] = $isArray(tracestate) ? tracestate[0] : tracestate;
  }

  return attributes;
}

/**
 * Build response attributes from ServerResponse (OpenTelemetry semantic conventions).
 */
function buildResponseAttributes(
  res: ServerResponse,
  statusCode: number,
  startTime: number,
  responseHeaders: string[],
): Record<string, any> {
  const opId = (res as any)[kOperationId];
  const attributes: Record<string, any> = {
    "operation.id": opId,
    "http.response.status_code": statusCode,
    "operation.duration": (performance.now() - startTime) * 1_000_000, // Convert to nanoseconds
  };

  // Extract content-length
  const contentLength = res.getHeader("content-length");
  if (contentLength) {
    const size = typeof contentLength === "number" ? contentLength : parseInt(String(contentLength), 10);
    if (!Number.isNaN(size)) {
      attributes["http.response.body.size"] = size;
    }
  }

  // Capture whitelisted response headers
  for (const headerName of responseHeaders) {
    const value = res.getHeader(headerName);
    if (value !== undefined) {
      const attrName = `http.response.header.${headerName.replace(/-/g, "_")}`;
      attributes[attrName] = $isArray(value) ? value[0] : String(value);
    }
  }

  return attributes;
}

/**
 * Build error attributes (OpenTelemetry semantic conventions).
 */
function buildErrorAttributes(
  opId: number,
  error: unknown,
  startTime: number,
  statusCode?: number,
): Record<string, any> {
  const attributes: Record<string, any> = {
    "operation.id": opId,
    "operation.duration": (performance.now() - startTime) * 1_000_000,
  };

  if (error instanceof Error) {
    attributes["error.type"] = error.name;
    attributes["error.message"] = error.message;
    if (error.stack) {
      attributes["error.stack_trace"] = error.stack;
    }
  } else {
    attributes["error.type"] = "UnknownError";
    attributes["error.message"] = String(error);
  }

  if (statusCode !== undefined) {
    attributes["http.response.status_code"] = statusCode;
  }

  return attributes;
}

/**
 * Invoke onOperationEnd via native hooks.
 */
function notifyOperationEnd(res: ServerResponse): void {
  const startTime = (res as any)[kStartTime];
  const opId = (res as any)[kOperationId];
  if (startTime === undefined || opId === undefined) return;

  const responseHeaders = nativeHooks.getConfigurationProperty(
    ConfigurationProperty.HTTP_CAPTURE_HEADERS_SERVER_RESPONSE,
  );
  const attributes = buildResponseAttributes(res, res.statusCode, startTime, responseHeaders);
  nativeHooks.notifyEnd(HTTP_KIND, opId, attributes);
}

/**
 * Invoke onOperationError via native hooks.
 */
function notifyOperationError(res: ServerResponse, error: unknown, errorType?: string): void {
  const startTime = (res as any)[kStartTime];
  const opId = (res as any)[kOperationId];
  if (startTime === undefined || opId === undefined) return;

  const attributes = buildErrorAttributes(opId, error, startTime, res.statusCode);
  if (errorType) {
    attributes["error.type"] = errorType;
  }
  nativeHooks.notifyError(HTTP_KIND, opId, attributes);
}

export default {
  /**
   * Called when an incoming HTTP request is received (Node.js http.Server).
   * Invoked by _http_server.ts in onNodeHTTPRequest callback.
   *
   * @param req Incoming HTTP request
   * @param res Server response
   * @returns Operation ID, or undefined if no instruments registered
   */
  handleIncomingRequest(req: IncomingMessage, res: ServerResponse): number | undefined {
    // Fast path: check if telemetry is enabled for HTTP
    if (!nativeHooks.isEnabledFor(HTTP_KIND)) return undefined;

    try {
      // Generate unique operation ID (nanosecond-based)
      const operationId = (performance.now() * 1_000_000) | 0;

      // Store operation metadata on response object
      (res as any)[kOperationId] = operationId;
      (res as any)[kStartTime] = performance.now();

      // Get configured headers to capture and build attributes
      const requestHeaders = nativeHooks.getConfigurationProperty(
        ConfigurationProperty.HTTP_CAPTURE_HEADERS_SERVER_REQUEST,
      );
      const attributes = buildRequestAttributes(req, operationId, requestHeaders);

      // Notify all registered instruments via native hooks
      nativeHooks.notifyStart(HTTP_KIND, operationId, attributes);

      // Attach lifecycle event listeners
      res.once("finish", () => notifyOperationEnd(res));

      res.once("error", (err: unknown) => notifyOperationError(res, err));

      res.once("close", () => {
        // Only treat as error if response didn't finish normally
        if (!res.writableEnded) {
          notifyOperationError(res, new Error("Request aborted"), "AbortError");
        }
      });

      res.once("timeout", () => notifyOperationError(res, new Error("Request timeout"), "TimeoutError"));

      return operationId;
    } catch (error) {
      // Silently fail - telemetry should never break the application
      return undefined;
    }
  },

  /**
   * Called when response.writeHead() is invoked (Node.js http.Server).
   * Invoked by _http_server.ts in _writeHead function.
   *
   * Implements distributed tracing header injection:
   * - Calls nativeHooks.notifyInject() to collect headers from all instruments
   * - Merges injected headers into response (linear concatenation, duplicates allowed)
   *
   * @param res Server response
   * @param statusCode HTTP status code
   * @returns Headers to inject (e.g., { "traceparent": "..." }), or undefined
   */
  handleWriteHead(res: ServerResponse, statusCode: number): Record<string, string> | undefined {
    // Fast path: check if telemetry is enabled
    if (!nativeHooks.isEnabledFor(HTTP_KIND)) return undefined;

    try {
      // Prevent duplicate emissions
      if ((res as any)[kHeadersEmitted]) return undefined;
      (res as any)[kHeadersEmitted] = true;

      const opId = (res as any)[kOperationId];
      if (opId === undefined) return undefined;

      // Get configured header names to propagate (e.g., ["traceparent", "tracestate"])
      const headerNames = nativeHooks.getConfigurationProperty(
        ConfigurationProperty.HTTP_PROPAGATE_HEADERS_SERVER_RESPONSE,
      );

      // Fast path: no headers configured
      if (!headerNames || !$isArray(headerNames) || headerNames.length === 0) {
        return undefined;
      }

      // Call all instruments to get header values (returns array of objects)
      const injectedValues = nativeHooks.notifyInject(HTTP_KIND, opId, undefined);

      // Fast path: no instruments returned values
      if (!injectedValues || !$isArray(injectedValues) || injectedValues.length === 0) {
        return undefined;
      }

      // Iterate through configured header names and set them on response
      // Using linear concatenation: duplicates allowed, set() calls accumulate
      for (const headerName of headerNames) {
        if (typeof headerName !== "string") continue;

        // Look up this header in all injected value objects
        for (const injected of injectedValues) {
          if (!$isObject(injected)) continue;

          const headerValue = injected[headerName];
          if (headerValue !== undefined && headerValue !== null && typeof headerValue === "string") {
            // Set header on response (allows duplicates via multiple setHeader calls)
            res.setHeader(headerName, headerValue);
          }
        }
      }

      // TODO: Call nativeHooks.notifyProgress() when progress tracking is needed

      return undefined;
    } catch (error) {
      // Silently fail
      return undefined;
    }
  },
};
