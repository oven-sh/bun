import type { Span, TracerProvider } from "@opentelemetry/api";
import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";

export interface TelemetryBridgeOptions {
  /**
   * TracerProvider to use for creating spans
   */
  tracerProvider: TracerProvider;

  /**
   * Name to use for the tracer
   * @default '@bun/otel'
   */
  tracerName?: string;
}

export interface TelemetryBridge {
  /**
   * Disable telemetry and clean up
   */
  disable(): void;
}

/**
 * Create a bridge between Bun's native telemetry and OpenTelemetry
 */
export function createTelemetryBridge(options: TelemetryBridgeOptions): TelemetryBridge {
  const { tracerProvider, tracerName = "@bun/otel" } = options;
  const tracer = tracerProvider.getTracer(tracerName);
  const spans = new Map<number, Span>();

  Bun.telemetry.configure({
    onRequestStart(id: number, request: Request) {
      // Extract trace context from headers
      const traceparent = request.headers.get("traceparent");
      const carrier = traceparent ? { traceparent } : {};
      const extractedContext = propagation.extract(context.active(), carrier);

      const url = new URL(request.url);
      const span = tracer.startSpan(
        `${request.method} ${url.pathname}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            "http.method": request.method,
            "http.url": request.url,
            "http.target": url.pathname,
            "http.scheme": url.protocol.replace(":", ""),
            "http.host": url.host,
            "http.user_agent": request.headers.get("user-agent") || undefined,
            "http.request_content_length": request.headers.get("content-length") || undefined,
          },
        },
        extractedContext,
      );

      spans.set(id, span);

      // Make span active for downstream operations
      return context.with(trace.setSpan(extractedContext, span), () => {});
    },

    onRequestEnd(id: number) {
      const span = spans.get(id);
      if (!span) return;

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      spans.delete(id);
    },

    onRequestError(id: number, error: Error) {
      const span = spans.get(id);
      if (!span) return;

      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
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

  return {
    disable() {
      Bun.telemetry.disable();
      spans.clear();
    },
  };
}
