import type { Span, Tracer, TracerProvider } from "@opentelemetry/api";
import { context, propagation, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { RequestLike } from "./otel-types";
import { getUrlInfo, requestLikeHeaderGetter } from "./otel-types";

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

  Bun.telemetry.configure({
    onRequestStart(id: number, request: RequestLike) {
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
    },

    onRequestEnd(id: number) {
      const span = spans.get(id);
      if (!span) return;

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      spans.delete(id);
    },

    onRequestError(id: number, error: unknown) {
      const span = spans.get(id);
      if (!span) return;

      // Normalize non-Error values to Error instances
      const err = error instanceof Error ? error : new Error(String(error ?? "Unknown error"));
      span.recordException(err);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message,
      });
      span.end();
      spans.delete(id);
    },

    onResponseHeaders(id: number, statusCode: number, contentLength: number) {
      const span = spans.get(id);
      if (!span) return;

      span.setAttribute("http.status_code", statusCode);
      if (contentLength > 0) {
        span.setAttribute("http.response_content_length", contentLength);
      }
    },
  });

  // Return cleanup function
  return () => {
    Bun.telemetry.disable();
    spans.clear();
  };
}
