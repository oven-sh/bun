import type { Span, Tracer, TracerProvider } from "@opentelemetry/api";
import { context, propagation, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HeadersLike, RequestLike } from "./otel-types";
import { getUrlInfo, headerLikeHeaderGetter, requestLikeHeaderGetter } from "./otel-types";

// Symbols for Node.js http.Server span tracking
const kSpan = Symbol("kOtelSpan");
const kTelemetryHeadersEmitted = Symbol("kTelemetryHeadersEmitted");

export interface InstallBunNativeTracingOptions {
  /**
   * TracerProvider to use for creating spans
   */
  tracerProvider: TracerProvider;

  /**
   * Name to use for the tracer
   * @default '@bun/otel'
   */
  tracerName?: string;

  /**
   * Optional span storage map (useful for testing or custom lifecycle management)
   */
  spans?: Map<number, Span>;

  /**
   * Response header name for trace ID correlation
   * @default "x-trace-id"
   * Set to `false` to disable trace ID injection
   *
   * The trace ID will be included in response headers to enable client-side
   * correlation with server traces. Useful for support tickets, debugging,
   * and log correlation.
   */
  correlationHeaderName?: string | false;

  /**
   * Request headers to capture as span attributes
   * Example: ["user-agent", "x-request-id", "accept"]
   */
  requestHeaderAttributes?: string[];

  /**
   * Response headers to capture as span attributes
   * Example: ["content-type", "cache-control", "x-response-time"]
   */
  responseHeaderAttributes?: string[];
}

/**
 * Install Bun native telemetry hooks for OpenTelemetry
 *
 * This function configures Bun.telemetry to automatically create OpenTelemetry spans
 * for all HTTP requests handled by Bun.serve() and Node.js http.createServer().
 *
 * @param options Configuration options
 * @returns Cleanup function to disable tracing
 */
export function installBunNativeTracing(options: InstallBunNativeTracingOptions): () => void {
  const { config, spans } = createBunTelemetryConfig(options);
  // ============================================================================
  // Configure Bun.telemetry with both Bun.serve and Node.js callbacks
  // ============================================================================
  Bun.telemetry.configure(config);
  // Return cleanup function
  return () => {
    Bun.telemetry.disable();
    spans.clear();
  };
}

/** Exposed for testing */
export function createBunTelemetryConfig(options: InstallBunNativeTracingOptions): {
  config: Bun.telemetry.TelemetryConfig;
  spans: Map<number, Span>;
} {
  const {
    tracerProvider,
    tracerName = "@bun/otel",
    spans: externalSpans,
    correlationHeaderName = "x-trace-id",
    requestHeaderAttributes = [],
    responseHeaderAttributes = [],
  } = options;

  const tracer: Tracer = tracerProvider.getTracer(tracerName);
  const spans = externalSpans ?? new Map<number, Span>();
  // Track spans that have had their status explicitly set
  const spansWithStatus = new WeakSet<Span>();

  // ============================================================================
  // Shared Helpers
  // ============================================================================

  /**
   * Record an error on a span (shared by both Bun.serve and Node.js http.Server)
   */
  function recordError(span: Span, error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error ?? "Unknown error"));
    span.recordException(err);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err.message,
    });
    spansWithStatus.add(span);
  }

  /**
   * Extract content-length from a ServerResponse
   */
  function extractContentLength(response: ServerResponse): number {
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
   * Set span status from HTTP status code
   * Only sets status if not already set (avoids overwriting ERROR with OK)
   */
  function setSpanStatusFromHttpCode(span: Span, statusCode: number): void {
    // Don't overwrite status if already set (e.g., from recordError)
    if (spansWithStatus.has(span)) {
      return;
    }

    // Set ERROR for 5xx, OK for everything else
    span.setStatus({
      code: statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    });
    spansWithStatus.add(span);
  }

  /**
   * Generic helper to capture configured headers (request or response) as span attributes
   * DRY replacement for separate request/response implementations.
   */
  function captureHeaderAttributes<T>(
    span: Span,
    carrier: T,
    headerNames: string[],
    headerGetter: { get: (carrier: T, key: string) => string | string[] | undefined },
    attrPrefix: string,
  ): void {
    if (headerNames.length === 0) return;
    for (const headerName of headerNames) {
      const raw = headerGetter.get(carrier, headerName);
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (value != null && value !== "") {
        const attrName = `${attrPrefix}${headerName.toLowerCase().replace(/-/g, "_")}`;
        span.setAttribute(attrName, value);
      }
    }
  }

  // ============================================================================
  // Bun.serve Callbacks (for Bun's native HTTP server)
  // ============================================================================

  function onRequestStart(id: number, request: RequestLike): void {
    try {
      // Extract trace context from headers
      const headerGetter = requestLikeHeaderGetter(request);
      const extractedContext = propagation.extract(context.active(), request, headerGetter);

      const urlInfo = getUrlInfo(request);
      const method = request.method ?? "UNKNOWN";
      const span = tracer.startSpan(
        `${method} ${urlInfo.pathname}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            "http.method": method,
            "http.url": urlInfo.fullUrl,
            "http.target": urlInfo.pathname,
            "http.scheme": urlInfo.scheme,
            "http.host": urlInfo.host,
            "http.user_agent": urlInfo.userAgent,
            "http.request_content_length": urlInfo.contentLength,
          },
        },
        extractedContext,
      );

      // Capture configured request headers as attributes
      // Sanitize headerGetter output to always be a string for attribute assignment
      captureHeaderAttributes(
        span,
        request,
        requestHeaderAttributes,
        {
          get: (carrier, key) => {
            const v = headerGetter.get(carrier, key);
            return Array.isArray(v) ? v[0] : v;
          },
        },
        "http.request.header.",
      );

      spans.set(id, span);

      // Phase 2: Context propagation via AsyncLocalStorage will be added in a future update.
      // The current implementation correctly extracts and uses trace context when starting spans,
      // but does not propagate the active span to downstream operations via context.with().
      // return context.with(trace.setSpan(extractedContext, span), () => {});
    } catch (error) {
      // Silently fail - telemetry should never break the application
    }
  }

  function onRequestEnd(id: number): void {
    try {
      const span = spans.get(id);
      if (!span) return;

      // Only set OK if status hasn't been set (don't overwrite ERROR)
      if (!spansWithStatus.has(span)) {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();
      spans.delete(id);
    } catch (error) {
      // Silently fail
    }
  }

  function onRequestError(id: number, error: unknown): void {
    try {
      const span = spans.get(id);
      if (!span) return;

      recordError(span, error);
      span.end();
      spans.delete(id);
    } catch (err) {
      // Silently fail
    }
  }

  function onResponseStart(id: number): string[] | undefined {
    // Early exit if correlation disabled (zero overhead path)
    if (!correlationHeaderName) return undefined;

    try {
      const span = spans.get(id);
      if (!span) return undefined;

      const traceId = span.spanContext().traceId;

      // Return only values (header names are pre-parsed at config time)
      return [traceId];
    } catch (error) {
      return undefined; // Silently fail - telemetry should never break app
    }
  }

  function onResponseHeaders(id: number, statusCode: number, contentLength: number, headers?: HeadersLike): void {
    try {
      const span = spans.get(id);
      if (!span) return;

      // Always set status code and content length
      span.setAttribute("http.status_code", statusCode);
      if (contentLength > 0) {
        span.setAttribute("http.response_content_length", contentLength);
      }

      // Capture configured response headers as attributes
      if (headers) {
        captureHeaderAttributes(
          span,
          headers,
          responseHeaderAttributes,
          headerLikeHeaderGetter(headers),
          "http.response.header.",
        );
      }

      // Set status based on HTTP status code
      setSpanStatusFromHttpCode(span, statusCode);
    } catch (error) {
      // Silently fail
    }
  }

  // ============================================================================
  // Node.js http.Server Callbacks (for Node.js compatibility)
  // ============================================================================

  function handleIncomingRequest(req: IncomingMessage, res: ServerResponse): number | undefined {
    try {
      // Extract context from incoming headers
      const extractedContext = propagation.extract(context.active(), req.headers);

      // Extract headers
      const method = req.method || "GET";
      const url = req.url || "/";
      const userAgent = req.headers["user-agent"];
      const host = req.headers["host"];
      const contentLengthHeader = req.headers["content-length"];
      const contentLength = typeof contentLengthHeader === "string" ? parseInt(contentLengthHeader, 10) : 0;

      // Determine scheme (http vs https) from the socket
      const scheme = (req.socket as any)?.encrypted ? "https" : "http";

      // Start a new span (match Bun.serve format: "GET /path" not "HTTP GET /path")
      const span = tracer.startSpan(
        `${method} ${url}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            "http.method": method,
            "http.url": url,
            "http.target": url,
            "http.scheme": scheme,
            "http.host": host,
            "http.user_agent": userAgent,
            "http.request_content_length": contentLength > 0 ? contentLength : undefined,
          },
        },
        extractedContext,
      );

      // Capture configured request headers as attributes
      captureHeaderAttributes(
        span,
        req.headers,
        requestHeaderAttributes,
        {
          get: (headers, key) => {
            const value = headers[key.toLowerCase()];
            if (value == null) return undefined;
            return Array.isArray(value) ? value[0] : String(value);
          },
        },
        "http.request.header.",
      );

      // Generate request ID
      const requestId = Bun.telemetry.generateRequestId();

      // Store span in BOTH the map and on the response object
      spans.set(requestId, span);
      (res as any)[kSpan] = span;

      // Attach one-time listeners using existing high-level telemetry handlers for DRYness.
      res.once("finish", () => onRequestEnd(requestId));
      res.once("error", (err: unknown) => onRequestError(requestId, err));
      res.once("close", () => onRequestError(requestId, new Error("Request aborted")));
      res.once("timeout", () => onRequestError(requestId, new Error("Request timeout")));

      return requestId;
    } catch (error) {
      return undefined;
    }
  }

  function handleWriteHead(response: ServerResponse, statusCode: number): void {
    try {
      // Prevent duplicate emissions
      if ((response as any)[kTelemetryHeadersEmitted]) {
        return;
      }
      (response as any)[kTelemetryHeadersEmitted] = true;

      const span: Span | undefined = (response as any)[kSpan];
      if (!span) return;

      // Inject correlation headers if configured
      if (correlationHeaderName) {
        const traceId = span.spanContext().traceId;
        response.setHeader(correlationHeaderName, traceId);
      }

      // Set HTTP response attributes
      span.setAttribute("http.status_code", statusCode);

      const contentLength = extractContentLength(response);
      if (contentLength > 0) {
        span.setAttribute("http.response_content_length", contentLength);
      }

      // Capture configured response headers as attributes
      if (responseHeaderAttributes.length > 0) {
        // Build a HeadersLike object from ServerResponse headers
        const headers: Record<string, string> = {};
        for (const headerName of responseHeaderAttributes) {
          const value = response.getHeader(headerName);
          if (value != null) {
            headers[headerName] = Array.isArray(value) ? value[0] : String(value);
          }
        }
        if (Object.keys(headers).length > 0) {
          captureHeaderAttributes(
            span,
            headers,
            responseHeaderAttributes,
            headerLikeHeaderGetter(headers),
            "http.response.header.",
          );
        }
      }

      // Set span status based on status code
      setSpanStatusFromHttpCode(span, statusCode);
    } catch (error) {
      // Silently fail
    }
  }

  return {
    config: {
      // Bun.serve callbacks
      onRequestStart,
      onRequestEnd,
      onRequestError,
      onResponseStart,
      correlationHeaderNames: correlationHeaderName ? [correlationHeaderName] : undefined,
      onResponseHeaders,

      // Node.js http.Server callbacks
      _node_binding: {
        handleIncomingRequest,
        handleWriteHead,
      },
    },
    spans,
  };
}
