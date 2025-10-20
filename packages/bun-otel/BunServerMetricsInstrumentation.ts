import { Counter, Histogram, Meter, ValueType } from "@opentelemetry/api";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_SCHEME,
  METRIC_HTTP_SERVER_REQUEST_DURATION,
} from "@opentelemetry/semantic-conventions";

/**
 * Instrumentation for Bun HTTP server metrics collection.
 *
 * This class creates and records OpenTelemetry metrics for HTTP server requests.
 * It is integrated with Bun's native telemetry hooks for zero-overhead metric recording.
 *
 * Metrics recorded:
 * - http.server.request.duration (Histogram): Request latency distribution
 * - http.server.requests.total (Counter): Total request count
 *
 * NOTE: This implementation records metrics from JavaScript for compatibility
 * with the standard OpenTelemetry SDK. For production deployments with extremely
 * high request rates (>100k RPS), consider implementing native metric recording
 * directly in Zig at the telemetry hook callsite. This would eliminate the
 * JS→Zig→JS round-trip and provide zero-overhead metric recording.
 *
 * See OTEL_METRICS_NATIVE_INSTRUMENTATION.md for native implementation design.
 */
export class BunServerMetricsInstrumentation {
  private serverDurationHistogram: Histogram;
  private serverRequestCounter: Counter;

  constructor(private meter: Meter) {
    // Create HTTP server duration histogram
    // Uses semantic convention metric name and bucket boundaries for web latencies
    this.serverDurationHistogram = meter.createHistogram(METRIC_HTTP_SERVER_REQUEST_DURATION, {
      unit: "s",
      description: "Duration of HTTP server requests",
      valueType: ValueType.DOUBLE,
      // Standard bucket boundaries for HTTP latencies (5ms to 10s)
      // These align with Prometheus best practices and OpenTelemetry conventions
      advice: {
        explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
      },
    });

    // Create HTTP server request counter
    this.serverRequestCounter = meter.createCounter("http.server.requests.total", {
      description: "Total number of HTTP server requests",
      unit: "1", // Dimensionless count
    });
  }

  /**
   * Record HTTP server request metrics.
   *
   * Called by Bun's native telemetry hook (onRequestEnd) when a request completes.
   * The duration is calculated natively in Zig using high-precision timers.
   *
   * @param requestId - Unique request identifier (unused for metrics, needed for tracing)
   * @param duration_s - Request duration in seconds (calculated in Zig)
   * @param request - Request object to extract metadata
   * @param response - Response object (if available) to extract status
   *
   * TODO: Consider extracting more attributes:
   * - http.route (requires route pattern extraction from URL)
   * - server.address / server.port (from request.url)
   * - network.protocol.version (HTTP/1.1, HTTP/2, etc.)
   * - error.type (for failed requests)
   *
   * NOTE: Keep attribute cardinality low! Each unique combination of attributes
   * creates a new metric series. Use route patterns (/users/{id}), not actual
   * values (/users/123). Avoid user IDs, session tokens, or high-cardinality data.
   */
  recordRequest(requestId: number, duration_s: number, request?: Request, response?: Response): void {
    // Build metric attributes from request/response
    // Using semantic convention attribute names for compatibility with OTel collectors
    const attributes: Record<string, string | number> = {};

    if (request) {
      // HTTP method (GET, POST, etc.)
      attributes[ATTR_HTTP_REQUEST_METHOD] = request.method;

      // URL scheme (http, https)
      try {
        const url = new URL(request.url);
        attributes[ATTR_URL_SCHEME] = url.protocol.replace(":", "");

        // Server address and port
        if (url.hostname) {
          attributes[ATTR_SERVER_ADDRESS] = url.hostname;
        }
        if (url.port) {
          attributes[ATTR_SERVER_PORT] = parseInt(url.port, 10);
        }
      } catch {
        // Invalid URL, skip URL-based attributes
      }
    }

    if (response) {
      // HTTP status code (200, 404, 500, etc.)
      attributes[ATTR_HTTP_RESPONSE_STATUS_CODE] = response.status;
    }

    // TODO: Extract HTTP version from request headers or Bun internal state
    // attributes[ATTR_NETWORK_PROTOCOL_VERSION] = '1.1' | '2' | '3';

    // TODO: Extract route pattern if available (requires integration with router)
    // attributes[ATTR_HTTP_ROUTE] = '/api/users/{id}';

    // Record histogram: duration distribution with attributes
    this.serverDurationHistogram.record(duration_s, attributes);

    // Record counter: total requests with attributes
    this.serverRequestCounter.add(1, attributes);
  }
}

// ============================================================================
// Global Registry for Native Hook Integration
// ============================================================================
//
// Bun's telemetry hooks (onRequestEnd) are configured globally via Bun.telemetry.configure().
// We need a way for the Zig hook to find the active BunServerMetricsInstrumentation instance.
//
// This uses a Symbol-based registry to allow multiple SDK instances while keeping the
// most recently registered instrumentation active.

const METRICS_HOOK_KEY = Symbol.for("bun.otel.serverMetrics");

// Use globalThis to store the registry across module boundaries
const globalRegistry = globalThis as typeof globalThis & {
  [METRICS_HOOK_KEY]?: BunServerMetricsInstrumentation;
};

/**
 * Register a BunServerMetricsInstrumentation instance for use by native hooks.
 *
 * Only one instrumentation can be active at a time. Registering a new instance
 * replaces the previous one. This matches the behavior of BunSDK where `start()`
 * can only be called once.
 *
 * @param instrumentation - The instrumentation instance to register
 */
export function registerServerMetricsHook(instrumentation: BunServerMetricsInstrumentation): void {
  globalRegistry[METRICS_HOOK_KEY] = instrumentation;
}

/**
 * Get the currently registered BunServerMetricsInstrumentation instance.
 *
 * Returns undefined if no instrumentation has been registered or if it was unregistered.
 *
 * @internal Used by telemetry hooks
 */
export function getServerMetricsInstrumentation(): BunServerMetricsInstrumentation | undefined {
  return globalRegistry[METRICS_HOOK_KEY];
}

/**
 * Unregister the currently active BunServerMetricsInstrumentation.
 *
 * Called when the SDK is shut down or disposed.
 */
export function unregisterServerMetricsHook(): void {
  delete globalRegistry[METRICS_HOOK_KEY];
}
