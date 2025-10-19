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
 */
export class BunFetchInstrumentation extends InstrumentationBase {
  private _originalFetch?: typeof globalThis.fetch;
  private _isPatched = false;

  constructor(config: InstrumentationConfig = {}) {
    super("@bun/otel-fetch-instrumentation", "1.0.0", config);
  }

  init() {
    // Instrumentation initialization happens in enable()
  }

  enable(): void {
    if (this._isPatched) {
      this._diag.warn("BunFetchInstrumentation already enabled");
      return;
    }

    // Save original fetch
    if (!this._originalFetch) {
      this._originalFetch = globalThis.fetch;
    }

    // Patch global fetch using _wrap for proper lifecycle management
    const instrumentation = this;
    const originalFetch = this._originalFetch;

    globalThis.fetch = function instrumentedFetch(
      this: typeof globalThis,
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

      // Start a new CLIENT span with active context as parent
      // CRITICAL: Use this.tracer (from InstrumentationBase) instead of trace.getTracer()
      // This ensures we use the TracerProvider that was set via setTracerProvider()
      const span = instrumentation.tracer.startSpan(
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

      // CRITICAL: Wrap the entire fetch call in context.with() synchronously
      // This ensures the context is active for the entire async operation
      return context.with(spanContext, () => {
        // Inject trace context headers into the request
        const headers = new Headers(init?.headers);
        propagation.inject(spanContext, headers, {
          set: (carrier, key, value) => {
            (carrier as Headers).set(key, value);
          },
        });

        // Execute fetch with injected headers and handle response
        return originalFetch
          .call(this, input, {
            ...init,
            headers,
          })
          .then(
            response => {
              // Success handler
              try {
                // Record response status
                span.setAttribute(SEMATTRS_HTTP_STATUS_CODE, response.status);
                span.setStatus({
                  code: response.status >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
                });

                debugLog(
                  `Ending CLIENT span: ${method} ${url}`,
                  `(spanId: ${span.spanContext().spanId}, traceId: ${span.spanContext().traceId})`,
                );
              } finally {
                debugLog(`About to end CLIENT span with SpanProcessor...`);
                span.end();
                debugLog(`CLIENT span ended, should be exported now`);
              }
              return response;
            },
            error => {
              // Error handler
              try {
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
              } finally {
                span.end();
              }
              throw error;
            },
          );
      });
    } as typeof globalThis.fetch;

    this._isPatched = true;
    debugLog("Enabled - global fetch is now instrumented");
  }

  disable(): void {
    if (!this._isPatched || !this._originalFetch) {
      return;
    }

    // Restore original fetch
    globalThis.fetch = this._originalFetch;
    this._isPatched = false;
    debugLog("Disabled - restored original fetch");
  }
}
