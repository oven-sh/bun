/**
 * BunFetchInstrumentation - Custom fetch instrumentation for Bun runtime
 *
 * WHY FORKED:
 * Official @opentelemetry/instrumentation-fetch is browser-only and explicitly
 * refuses to enable on Node.js-like environments (checks process.release.name).
 * It also depends on browser APIs (PerformanceObserver) and sdk-trace-web, making
 * it incompatible with server-side runtimes like Bun.
 *
 * REFERENCE:
 * Based on patterns from:
 * https://github.com/open-telemetry/opentelemetry-js/blob/main/experimental/packages/opentelemetry-instrumentation-fetch/
 * https://github.com/open-telemetry/opentelemetry-js/blob/main/experimental/packages/opentelemetry-instrumentation-http/
 *
 * KEY DIFFERENCES:
 * - Works on Bun (no Node.js detection that blocks activation)
 * - Server-side optimized (no PerformanceObserver delays)
 * - Defensive patching guards (prevents test isolation issues)
 * - Uses sdk-trace-base/node instead of sdk-trace-web
 */

import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InstrumentationBase,
  InstrumentationConfig,
  isWrapped,
  SemconvStability,
  semconvStabilityFromStr,
} from "@opentelemetry/instrumentation";
import {
  // Stable semconv (1.27+)
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_URL_FULL,
  // Old (deprecated) semconv - still supported for backward compatibility
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

// ============================================================================
// DEFENSIVE PATCHING GUARDS
// ============================================================================

// Symbol to mark patched fetch functions
const kBunOtelPatched = Symbol("kBunOtelPatched");

// Store the ORIGINAL unpatched fetch (defensive copy at module load)
const ORIGINAL_FETCH = globalThis.fetch;

// WeakMap to track all patched versions (for debugging)
const PATCHED_FETCH_INSTANCES = new WeakMap<
  typeof globalThis.fetch,
  {
    instrumentationId: string;
    patchedAt: number;
  }
>();

// Check if a function is already patched by us
function isBunOtelPatched(fn: any): boolean {
  return fn && typeof fn === "function" && fn[kBunOtelPatched] === true;
}

// Mark a function as patched
function markAsPatched(fn: any, instrumentationId: string): void {
  fn[kBunOtelPatched] = true;
  PATCHED_FETCH_INSTANCES.set(fn, {
    instrumentationId,
    patchedAt: Date.now(),
  });
}

/**
 * Configuration for BunFetchInstrumentation
 *
 * Supports both programmatic configuration and environment variable fallbacks.
 * Programmatic config takes precedence over env vars.
 */
export interface BunFetchInstrumentationConfig extends InstrumentationConfig {
  /**
   * Semantic convention stability level. Controls which attributes are emitted:
   * - 'old': Emit only deprecated attributes (http.method, http.url, http.status_code)
   * - 'stable' or 'http': Emit only stable attributes (http.request.method, url.full, http.response.status_code)
   * - 'http/dup': Emit both old and stable (recommended for migration period)
   *
   * Programmatic value takes precedence over OTEL_SEMCONV_STABILITY_OPT_IN env var.
   *
   * @default 'http/dup' (emit both for maximum compatibility during migration)
   */
  semconvStabilityOptIn?: string;
}

/**
 * BunFetchInstrumentation - Automatic instrumentation for Bun's global fetch API
 *
 * Creates CLIENT spans for outbound fetch requests and automatically injects
 * trace context headers (traceparent) for distributed tracing.
 */
export class BunFetchInstrumentation extends InstrumentationBase<BunFetchInstrumentationConfig> {
  private _semconvStability: SemconvStability;

  constructor(config: BunFetchInstrumentationConfig = {}) {
    super("@bun/otel-fetch-instrumentation", "1.0.0", config);

    // Determine semconv stability from config (programmatic) or env var (fallback)
    // Programmatic config takes precedence per best practice
    // Default to 'http/dup' (emit both) for maximum compatibility during migration
    const semconvOptIn = config.semconvStabilityOptIn ?? process.env.OTEL_SEMCONV_STABILITY_OPT_IN ?? "http/dup";
    this._semconvStability = semconvStabilityFromStr("http", semconvOptIn);
  }

  init() {
    // For global API instrumentations, init() is typically empty
  }

  override enable(): void {
    const currentFetch = globalThis.fetch;
    const shimmerWrapped = isWrapped(currentFetch);
    const bunOtelPatched = isBunOtelPatched(currentFetch);

    debugLog(`enable() called:`);
    debugLog(`  shimmer isWrapped: ${shimmerWrapped}`);
    debugLog(`  BunOtel patched: ${bunOtelPatched}`);
    debugLog(`  current fetch === ORIGINAL_FETCH: ${currentFetch === ORIGINAL_FETCH}`);

    // DEFENSIVE: Check for disagreement between shimmer and our tracking
    if (shimmerWrapped !== bunOtelPatched) {
      debugLog(`⚠️ DISAGREEMENT! shimmer says ${shimmerWrapped}, our symbol says ${bunOtelPatched}`);
    }

    // If already patched by us, don't re-patch!
    if (bunOtelPatched) {
      debugLog("❌ Already patched by BunOtel, skipping re-patch");
      const patchInfo = PATCHED_FETCH_INSTANCES.get(currentFetch);
      if (patchInfo) {
        debugLog(
          `   Existing patch from: ${patchInfo.instrumentationId} at ${new Date(patchInfo.patchedAt).toISOString()}`,
        );
      }
      return;
    }

    // If shimmer thinks it's wrapped, unwrap it first
    if (shimmerWrapped) {
      debugLog("Removing shimmer wrapper before applying our patch...");
      this._unwrap(globalThis, "fetch");
    }

    // Apply our patch
    this._wrap(globalThis, "fetch", this._patchFetch());

    // Mark the new patched version
    markAsPatched(globalThis.fetch, this.instrumentationName);

    debugLog("✅ Enabled - global fetch is now instrumented");
    debugLog(`   New fetch === ORIGINAL_FETCH: ${globalThis.fetch === ORIGINAL_FETCH}`);
  }

  override disable(): void {
    const currentFetch = globalThis.fetch;
    const bunOtelPatched = isBunOtelPatched(currentFetch);

    debugLog(`disable() called:`);
    debugLog(`  BunOtel patched: ${bunOtelPatched}`);
    debugLog(`  current fetch === ORIGINAL_FETCH: ${currentFetch === ORIGINAL_FETCH}`);

    // CRITICAL: Only unwrap if we actually patched it
    // Don't clobber patches from other instrumentations
    if (!bunOtelPatched) {
      debugLog("⚠️ Not patched by us, skipping unwrap");
      return;
    }

    // Unwrap using shimmer
    this._unwrap(globalThis, "fetch");

    // DEFENSIVE: If unwrap didn't work, force restore original
    // Only do this if the current fetch is still marked as ours
    if (globalThis.fetch !== ORIGINAL_FETCH && isBunOtelPatched(globalThis.fetch)) {
      debugLog("⚠️ Shimmer unwrap failed, forcing restore to ORIGINAL_FETCH");
      globalThis.fetch = ORIGINAL_FETCH;
    }

    debugLog("✅ Disabled - restored original fetch");
    debugLog(`   After disable, fetch === ORIGINAL_FETCH: ${globalThis.fetch === ORIGINAL_FETCH}`);
  }

  /**
   * Creates the patched fetch function
   * This follows the shimmer pattern: returns a function that takes the original
   * and returns the wrapped version
   */
  private _patchFetch() {
    const instrumentation = this;

    return (originalFetch: typeof globalThis.fetch): typeof globalThis.fetch => {
      return function patchedFetch(
        this: typeof globalThis,
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        // Extract URL and method for span naming
        // Handle input as string, URL, or Request object
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
        const method = init?.method?.toUpperCase() || (input instanceof Request ? input.method.toUpperCase() : "GET");

        // Get active context - this is critical for distributed tracing!
        const activeContext = context.active();
        const activeSpan = trace.getSpan(activeContext);

        debugLog(
          `Before creating CLIENT span, context.active() has span: spanId=${activeSpan?.spanContext().spanId || "undefined"}, traceId=${activeSpan?.spanContext().traceId || "undefined"}`,
        );
        debugLog(`  context manager:`, (context as any)._getContextManager?.() || "no context manager");

        // Build span attributes based on semconv stability setting
        const attributes: Record<string, string> = {};

        // Emit old (deprecated) attributes if configured
        if (instrumentation._semconvStability & SemconvStability.OLD) {
          attributes[SEMATTRS_HTTP_METHOD] = method;
          attributes[SEMATTRS_HTTP_URL] = url;
        }

        // Emit stable attributes if configured
        if (instrumentation._semconvStability & SemconvStability.STABLE) {
          attributes[ATTR_HTTP_REQUEST_METHOD] = method;
          attributes[ATTR_URL_FULL] = url;
        }

        // Start a new CLIENT span with active context as parent
        // CRITICAL: Use this.tracer (from InstrumentationBase) instead of trace.getTracer()
        // This ensures we use the TracerProvider that was set via setTracerProvider()
        // Span naming: Use just the HTTP method (not method + URL) per OTel standards
        // URL is captured in attributes only to avoid PII in span names
        const span = instrumentation.tracer.startSpan(
          `HTTP ${method}`,
          {
            kind: SpanKind.CLIENT,
            attributes,
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
          // Merge headers: start with input Request headers (if any), then overlay init.headers
          // This preserves headers from Request objects while allowing init to override
          const headers = new Headers(input instanceof Request ? input.headers : undefined);
          if (init?.headers) {
            new Headers(init.headers).forEach((value, key) => headers.set(key, value));
          }

          // CRITICAL: Use context.active() here, NOT spanContext directly!
          // We're inside context.with(spanContext), so context.active() returns spanContext,
          // but propagation.inject() expects to serialize from context.active()
          propagation.inject(context.active(), headers, {
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
                  // Record response status based on semconv stability setting
                  if (instrumentation._semconvStability & SemconvStability.OLD) {
                    span.setAttribute(SEMATTRS_HTTP_STATUS_CODE, response.status);
                  }
                  if (instrumentation._semconvStability & SemconvStability.STABLE) {
                    span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, response.status);
                  }
                  // Set span status: 5xx = ERROR, others = OK (matches OTel guidance)
                  span.setStatus({
                    code: response.status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
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
      };
    };
  }
}
