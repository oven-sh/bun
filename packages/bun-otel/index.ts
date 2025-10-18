import type { Span, TextMapGetter, TracerProvider } from "@opentelemetry/api";
import { context, propagation, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { IncomingMessage } from "http";

// Request-like type for different server implementations
type RequestLike = Request | IncomingMessage;

// Type guard for fetch API Request
function isFetchRequest(req: RequestLike): req is Request {
  return req instanceof Request;
}
function getHeaderGetter(req: RequestLike): TextMapGetter<RequestLike> {
  return req ? (isFetchRequest(req) ? fetchHeaderGetter : nodeHeaderGetter) : nilHeaderGetter;
}

// Header getter for context propagation
const headerGetter: TextMapGetter<RequestLike> = {
  keys(carrier: RequestLike): string[] {
    if (isFetchRequest(carrier)) {
      return Array.from(carrier.headers.keys());
    }
    // IncomingMessage
    return Object.keys(carrier.headers || {});
  },
  get(carrier: RequestLike, key: string): string | undefined {
    if (isFetchRequest(carrier)) {
      return carrier.headers.get(key) || undefined;
    }
    // IncomingMessage
    const value = carrier.headers?.[key.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  },
};

interface UrlInfo {
  fullUrl: string;
  pathname: string;
  host: string;
  scheme: string;
  userAgent: string | undefined;
  contentLength: number | undefined;
}

function getUrlInfo(req: RequestLike): UrlInfo {
  if (isFetchRequest(req)) {
    const url = new URL(req.url);
    const contentLengthHeader = req.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;

    return {
      fullUrl: req.url,
      pathname: url.pathname,
      host: url.host,
      scheme: url.protocol.replace(":", ""),
      userAgent: req.headers.get("user-agent") || undefined,
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    };
  }

  // IncomingMessage (Node.js http.createServer)
  const host = (Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host) || "localhost";
  const protocol = (req.socket as any)?.encrypted ? "https" : "http";
  const pathname = req.url || "/";
  const fullUrl = `${protocol}://${host}${pathname}`;

  const userAgent = req.headers["user-agent"];
  const contentLengthHeader = req.headers["content-length"];
  const contentLengthStr = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader;
  const contentLength = contentLengthStr ? Number(contentLengthStr) : undefined;

  return {
    fullUrl,
    pathname,
    host,
    scheme: protocol,
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
  };
}

export interface BunSDKConfiguration {
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

/**
 * OpenTelemetry SDK for Bun
 *
 * Automatically instruments Bun's native HTTP server via Bun.telemetry hooks.
 * Use this with any OpenTelemetry TracerProvider.
 */
export class BunSDK {
  private tracerProvider: TracerProvider;
  private tracerName: string;
  private spans = new Map<number, Span>();
  private started = false;

  constructor(config: BunSDKConfiguration) {
    this.tracerProvider = config.tracerProvider;
    this.tracerName = config.tracerName ?? "@bun/otel";
  }

  /**
   * Start instrumentation and configure Bun telemetry
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    const tracer = this.tracerProvider.getTracer(this.tracerName);
    const spans = this.spans;

    Bun.telemetry.configure({
      onRequestStart(id: number, request: RequestLike) {
        // Extract trace context from headers
        const headerGetter = getHeaderGetter(request);
        const extractedContext = propagation.extract(context.active(), request, headerGetter);

        const urlInfo = getUrlInfo(request);
        const span = tracer.startSpan(
          `${request.method} ${urlInfo.pathname}`,
          {
            kind: SpanKind.SERVER,
            attributes: {
              "http.method": request.method,
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
  }

  /**
   * Stop instrumentation and disable Bun telemetry
   */
  shutdown(): void {
    if (!this.started) return;
    this.started = false;

    Bun.telemetry.disable();
    this.spans.clear();
  }
}

const nilHeaderGetter: TextMapGetter<unknown> = {
  keys(_carrier: unknown): string[] {
    return [];
  },
  get(_carrier: unknown, _key: string): string | undefined {
    return undefined;
  },
};
const fetchHeaderGetter: TextMapGetter<Request> = {
  keys(carrier: Request): string[] {
    return Array.from(carrier.headers.keys());
  },
  get(carrier: Request, key: string): string | undefined {
    return carrier.headers.get(key) || undefined;
  },
};
const nodeHeaderGetter: TextMapGetter<IncomingMessage> = {
  keys(carrier: IncomingMessage): string[] {
    return Object.keys(carrier.headers || {});
  },
  get(carrier: IncomingMessage, key: string): string | undefined {
    const value = carrier.headers?.[key.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  },
};
