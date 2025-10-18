import type { Span, Tracer, TracerProvider } from "@opentelemetry/api";
import { context, propagation, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestLike } from "./otel-types";
import { getUrlInfo, requestLikeHeaderGetter } from "./otel-types";

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
  const { tracerProvider, tracerName = "@bun/otel", spans: externalSpans } = options;

  const tracer: Tracer = tracerProvider.getTracer(tracerName);
  const spans = externalSpans ?? new Map<number, Span>();

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

      span.setStatus({ code: SpanStatusCode.OK });
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

  function onResponseHeaders(id: number, statusCode: number, contentLength: number): void {
    try {
      const span = spans.get(id);
      if (!span) return;

      span.setAttribute("http.status_code", statusCode);
      if (contentLength > 0) {
        span.setAttribute("http.response_content_length", contentLength);
      }
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

      // Start a new span
      const span = tracer.startSpan(
        `HTTP ${req.method} ${req.url}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            "http.method": req.method || "GET",
            "http.url": req.url || "/",
            "http.target": req.url || "/",
          },
        },
        extractedContext,
      );

      // Generate request ID
      const requestId = Bun.telemetry.generateRequestId();

      // Store span in BOTH the map and on the response object
      spans.set(requestId, span);
      (res as any)[kSpan] = span;

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

      // Set HTTP response attributes
      span.setAttribute("http.status_code", statusCode);

      const contentLength = extractContentLength(response);
      if (contentLength > 0) {
        span.setAttribute("http.response_content_length", contentLength);
      }

      // Set span status based on status code
      if (statusCode >= 400) {
        span.setStatus({
          code: statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        });
      }
    } catch (error) {
      // Silently fail
    }
  }

  function handleRequestAbort(response: ServerResponse): void {
    try {
      const span: Span | undefined = (response as any)[kSpan];
      if (!span) return;

      recordError(span, new Error("Request aborted"));
      span.end();

      delete (response as any)[kSpan];
    } catch (error) {
      // Silently fail
    }
  }

  function handleRequestTimeout(response: ServerResponse): void {
    try {
      const span: Span | undefined = (response as any)[kSpan];
      if (!span) return;

      recordError(span, new Error("Request timeout"));
      span.end();

      delete (response as any)[kSpan];
    } catch (error) {
      // Silently fail
    }
  }

  function handleRequestFinish(response: ServerResponse): void {
    try {
      const span: Span | undefined = (response as any)[kSpan];
      if (!span) return;

      span.end();
      delete (response as any)[kSpan];
    } catch (error) {
      // Silently fail
    }
  }

  function handleRequestError(response: ServerResponse, error: unknown): void {
    try {
      const span: Span | undefined = (response as any)[kSpan];
      if (!span) return;

      recordError(span, error);
      span.end();

      delete (response as any)[kSpan];
    } catch (err) {
      // Silently fail
    }
  }

  // ============================================================================
  // Configure Bun.telemetry with both Bun.serve and Node.js callbacks
  // ============================================================================

  Bun.telemetry.configure({
    // Bun.serve callbacks
    onRequestStart,
    onRequestEnd,
    onRequestError,
    onResponseHeaders,

    // Node.js http.Server callbacks
    _node_binding: {
      handleIncomingRequest,
      handleWriteHead,
      handleRequestAbort,
      handleRequestTimeout,
      handleRequestFinish,
      handleRequestError,
    },
  });

  // Return cleanup function
  return () => {
    Bun.telemetry.disable();
    spans.clear();
  };
}
