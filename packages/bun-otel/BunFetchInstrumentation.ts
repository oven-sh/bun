import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { InstrumentationBase, InstrumentationConfig } from "@opentelemetry/instrumentation";
import {
  SEMATTRS_HTTP_METHOD,
  SEMATTRS_HTTP_STATUS_CODE,
  SEMATTRS_HTTP_URL,
} from "@opentelemetry/semantic-conventions";

const ENABLE_DEBUG_LOGGING = false;

function debugLog(...args: unknown[]) {
  if (ENABLE_DEBUG_LOGGING) {
    console.log("[BunFetchInstrumentation]", ...args);
  }
}

/**
 * BunFetchInstrumentation - Automatic instrumentation for Bun's global fetch API
 *
 * Creates CLIENT spans for outbound fetch requests and automatically injects
 * trace context headers (traceparent) for distributed tracing.
 *
 * Uses OpenTelemetry's `isWrapped`, `_wrap`, and `_unwrap` utilities for proper
 * instrumentation lifecycle management.
 */
export class BunFetchInstrumentation extends InstrumentationBase {
  constructor(config: InstrumentationConfig = {}) {
    super("@bun/otel-fetch-instrumentation", "1.0.0", config);
  }

  init() {
    // Instrumentation initialization happens in enable()
  }

  override enable(): void {
    super.enable();

    const { isWrapped } = require("@opentelemetry/instrumentation");

    // If already wrapped, unwrap first (handles re-instrumentation)
    if (isWrapped(globalThis.fetch)) {
      this._unwrap(globalThis, "fetch");
      debugLog("Unwrapped previously instrumented fetch");
    }

    // Wrap fetch with our instrumentation
    this._wrap(globalThis, "fetch", this._patchFetch());
    debugLog("Enabled - global fetch is now instrumented");
  }

  override disable(): void {
    this._unwrap(globalThis, "fetch");
    debugLog("Disabled - restored original fetch");

    super.disable();
  }

  private _patchFetch(): (original: typeof globalThis.fetch) => typeof globalThis.fetch {
    const instrumentation = this;

    return function patchFetch(original: typeof globalThis.fetch): typeof globalThis.fetch {
      return function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        return instrumentation._tracedFetch(original, input, init);
      } as typeof globalThis.fetch;
    };
  }

  private async _tracedFetch(
    originalFetch: typeof globalThis.fetch,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Extract URL for span naming
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method?.toUpperCase() || "GET";

    // Get active context - this is critical for distributed tracing!
    const activeContext = context.active();
    const activeSpan = trace.getSpan(activeContext);

    debugLog(
      `Before creating CLIENT span, context.active() has span: spanId=${activeSpan?.spanContext().spanId || "undefined"}, traceId=${activeSpan?.spanContext().traceId || "undefined"}`,
    );

    // Start a new CLIENT span
    const tracer = trace.getTracer(this.instrumentationName, this.instrumentationVersion);
    const span = tracer.startSpan(
      `${method} ${url}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          [SEMATTRS_HTTP_METHOD]: method,
          [SEMATTRS_HTTP_URL]: url,
        },
      },
      activeContext, // CRITICAL: Use active context as parent
    );

    debugLog(
      `Created CLIENT span: ${method} ${url}`,
      `(spanId: ${span.spanContext().spanId}, ` +
        `parentSpanId: ${activeSpan?.spanContext().spanId || "undefined"}, ` +
        `traceId: ${span.spanContext().traceId})`,
    );

    // Create new context with this span
    const spanContext = trace.setSpan(activeContext, span);

    // Inject trace context headers into the request
    const headers = new Headers(init?.headers);
    propagation.inject(spanContext, headers, {
      set: (carrier, key, value) => {
        (carrier as Headers).set(key, value);
      },
    });

    // Execute fetch with injected headers
    return context.with(spanContext, async () => {
      try {
        const response = await originalFetch(input, {
          ...init,
          headers,
        });

        // Record response status
        span.setAttribute(SEMATTRS_HTTP_STATUS_CODE, response.status);
        span.setStatus({
          code: response.status >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        });

        debugLog(
          `Ending CLIENT span: ${method} ${url}`,
          `(spanId: ${span.spanContext().spanId}, traceId: ${span.spanContext().traceId})`,
        );

        span.end();
        return response;
      } catch (error) {
        // Record error
        const err = error instanceof Error ? error : new Error(String(error));
        span.recordException(err);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message,
        });

        debugLog(
          `Error in CLIENT span: ${method} ${url}`,
          `(spanId: ${span.spanContext().spanId}, error: ${err.message})`,
        );

        span.end();
        throw error;
      }
    });
  }
}
