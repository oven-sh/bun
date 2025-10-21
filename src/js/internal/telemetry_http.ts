// Hardcoded module "internal/telemetry_http"
// Node.js HTTP server telemetry integration
//
// This module bridges Bun.telemetry's native instrumentation API with Node.js http.Server.
// It maintains a registry of HTTP instruments and proxies lifecycle events to their hooks.
//
// Flow:
// 1. User calls Bun.telemetry.attach({ type: InstrumentKind.HTTP, ... })
// 2. Zig validates, stores instrument, calls registerInstrument() (this module)
// 3. _http_server.ts calls handleIncomingRequest() and handleWriteHead()
// 4. This module builds attribute objects and invokes all registered instruments

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * HTTP instrumentation registered via Bun.telemetry.attach()
 */
interface HttpInstrument {
  // Metadata
  id: number;
  name: string;
  version: string;

  // Header capture configuration (passed from Zig as JSValue string[])
  requestHeaders: string[];
  responseHeaders: string[];

  // Lifecycle hooks (at least one will be defined)
  onOperationStart?: (id: number, attributes: Record<string, any>) => void;
  onOperationProgress?: (id: number, attributes: Record<string, any>) => void;
  onOperationEnd?: (id: number, attributes: Record<string, any>) => void;
  onOperationError?: (id: number, attributes: Record<string, any>) => void;
  onOperationInject?: (id: number, data?: unknown) => Record<string, string> | void;
}

// Registry of active HTTP instruments (supports multiple for robustness/testing)
const instruments: HttpInstrument[] = [];

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
  const attributes: Record<string, any> = {
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
function buildErrorAttributes(error: unknown, startTime: number, statusCode?: number): Record<string, any> {
  const attributes: Record<string, any> = {
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
 * Invoke onOperationEnd for all registered instruments.
 */
function notifyOperationEnd(res: ServerResponse): void {
  const startTime = (res as any)[kStartTime];
  const opId = (res as any)[kOperationId];
  if (startTime === undefined || opId === undefined) return;

  for (const instrument of instruments) {
    if (instrument.onOperationEnd) {
      try {
        const attributes = buildResponseAttributes(res, res.statusCode, startTime, instrument.responseHeaders);
        instrument.onOperationEnd(opId, attributes);
      } catch (err) {
        // Silently fail - telemetry should never break the application
      }
    }
  }
}

/**
 * Invoke onOperationError for all registered instruments.
 */
function notifyOperationError(res: ServerResponse, error: unknown, errorType?: string): void {
  const startTime = (res as any)[kStartTime];
  const opId = (res as any)[kOperationId];
  if (startTime === undefined || opId === undefined) return;

  for (const instrument of instruments) {
    if (instrument.onOperationError) {
      try {
        const attributes = buildErrorAttributes(error, startTime, res.statusCode);
        if (errorType) {
          attributes["error.type"] = errorType;
        }
        instrument.onOperationError(opId, attributes);
      } catch (err) {
        // Silently fail
      }
    }
  }
}

export default {
  /**
   * Register an HTTP instrumentation.
   * Called from Zig via telemetry_http.zig when Bun.telemetry.attach({ type: InstrumentKind.HTTP, ... }) is invoked.
   *
   * @param instrument Instrumentation metadata and hooks
   */
  registerInstrument(instrument: HttpInstrument): void {
    instruments.push(instrument);
  },

  /**
   * Unregister an HTTP instrumentation.
   * Called from Zig via telemetry_http.zig when Bun.telemetry.detach(id) is invoked.
   *
   * @param id Instrument ID to remove
   */
  unregisterInstrument(id: number): void {
    const index = instruments.findIndex(inst => inst.id === id);
    if (index !== -1) {
      instruments.splice(index, 1);
    }
  },

  /**
   * Called when an incoming HTTP request is received (Node.js http.Server).
   * Invoked by _http_server.ts in onNodeHTTPRequest callback.
   *
   * @param req Incoming HTTP request
   * @param res Server response
   * @returns Operation ID, or undefined if no instruments registered
   */
  handleIncomingRequest(req: IncomingMessage, res: ServerResponse): number | undefined {
    if (instruments.length === 0) return undefined;

    try {
      // Generate unique operation ID (nanosecond-based)
      const operationId = (performance.now() * 1_000_000) | 0;

      // Store operation metadata on response object
      (res as any)[kOperationId] = operationId;
      (res as any)[kStartTime] = performance.now();

      // Invoke onOperationStart for each registered instrument
      for (const instrument of instruments) {
        if (instrument.onOperationStart) {
          try {
            const attributes = buildRequestAttributes(req, operationId, instrument.requestHeaders);
            instrument.onOperationStart(operationId, attributes);
          } catch (err) {
            // Silently fail
          }
        }
      }

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
   * Collects headers to inject from all instruments and notifies about response progress.
   *
   * @param res Server response
   * @param statusCode HTTP status code
   * @returns Headers to inject (e.g., { "x-trace-id": "..." }), or undefined
   */
  handleWriteHead(res: ServerResponse, statusCode: number): Record<string, string> | undefined {
    if (instruments.length === 0) return undefined;

    try {
      // Prevent duplicate emissions
      if ((res as any)[kHeadersEmitted]) return undefined;
      (res as any)[kHeadersEmitted] = true;

      const opId = (res as any)[kOperationId];
      if (opId === undefined) return undefined;

      let headersToInject: Record<string, string> | undefined = undefined;

      // Invoke onOperationInject for each instrument (collect headers to inject)
      for (const instrument of instruments) {
        if (instrument.onOperationInject) {
          try {
            const headers = instrument.onOperationInject(opId);
            if (headers && typeof headers === "object") {
              headersToInject = headersToInject || {};
              $Object.assign(headersToInject, headers);
            }
          } catch (err) {
            // Silently fail
          }
        }
      }

      // Invoke onOperationProgress for each instrument (response headers being written)
      for (const instrument of instruments) {
        if (instrument.onOperationProgress) {
          try {
            const startTime = (res as any)[kStartTime];
            if (startTime !== undefined) {
              const attributes = buildResponseAttributes(res, statusCode, startTime, instrument.responseHeaders);
              instrument.onOperationProgress(opId, attributes);
            }
          } catch (err) {
            // Silently fail
          }
        }
      }

      return headersToInject;
    } catch (error) {
      // Silently fail
      return undefined;
    }
  },
};
