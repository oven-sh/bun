/**
 * Clean facade over OpenTelemetry APIs
 *
 * Instruments interact ONLY with this interface - no direct OTel imports!
 */

export interface OtelCapabilities {
  /** Is tracing enabled? */
  readonly tracingEnabled: boolean;

  /** Are metrics enabled? */
  readonly metricsEnabled: boolean;

  /**
   * Start a new span/operation
   * @param id Operation ID
   * @param attributes Attributes from native layer
   */
  startSpan(id: number, attributes: Record<string, any>): void;

  /**
   * Update an active span with new attributes
   * @param id Operation ID
   * @param attributes New attributes to add
   */
  updateSpan(id: number, attributes: Record<string, any>): void;

  /**
   * End a span successfully
   * @param id Operation ID
   * @param attributes Final attributes
   */
  endSpan(id: number, attributes: Record<string, any>): void;

  /**
   * End a span with an error
   * @param id Operation ID
   * @param attributes Error attributes (error.type, exception.message, etc.)
   */
  errorSpan(id: number, attributes: Record<string, any>): void;

  /**
   * Get trace context for header injection
   * @param id Operation ID
   * @returns Trace headers if tracing enabled, undefined otherwise
   */
  getTraceInfo(id: number): { traceparent: string; tracestate: string } | undefined;
}

/**
 * Configuration for which attributes to capture at each lifecycle phase
 */
export interface AttributesToCapture {
  /** Attributes to capture when operation starts */
  start?: string[];

  /** Attributes to capture during operation progress */
  update?: string[];

  /** Attributes to capture when operation ends */
  end?: string[];

  /** Attributes to capture on error */
  err?: string[];
}

/**
 * Configuration for metric instruments
 */
export interface MetricInstrumentConfig {
  /** Counter for operation count */
  counter?: {
    name: string;
    description?: string;
    unit?: string;
  };

  /** Histogram for operation duration */
  histogram?: {
    name: string;
    description?: string;
    unit?: string;
    buckets?: number[];
  };
}

/**
 * Configuration for creating OtelCapabilities
 */
export interface CapabilitiesConfig {
  /**
   * Should this instrumentation update async context?
   *
   * - true: SERVER spans (makes span available to downstream fetch calls)
   * - false: CLIENT spans (don't overwrite parent server span)
   */
  setsAsyncStorageContext?: boolean;

  /**
   * Context manager for async context propagation
   * Required if setsAsyncStorageContext is true
   * Must implement enterWith(context) method for context propagation
   */
  contextManager?: any; // ContextManager but avoiding import

  /**
   * Attributes to capture for traces at each lifecycle phase
   */
  trace?: AttributesToCapture;

  /**
   * Attributes to use as metric dimensions at each lifecycle phase
   */
  metrics?: AttributesToCapture;

  /**
   * Metric instrument definitions
   */
  metricInstruments?: MetricInstrumentConfig;

  /**
   * Where does native provide duration measurement?
   *
   * - "end": Native provides "operation.duration" in endSpan attributes (nanoseconds)
   * - "update": Native provides "operation.duration" in updateSpan attributes (for progressive operations like SQLite)
   * - undefined: Track duration internally (process.hrtime.bigint() from start to end)
   */
  nativeDuration?: "end" | "update" | undefined;

  /**
   * Extract parent trace context from attributes
   *
   * Used for SERVER spans to extract traceparent/tracestate from request headers
   *
   * @example
   * ```typescript
   * extractParentContext: (attrs) => ({
   *   traceparent: attrs["http.request.header.traceparent"],
   *   tracestate: attrs["http.request.header.tracestate"],
   * })
   * ```
   */
  extractParentContext?: (attributes: Record<string, any>) => {
    traceparent?: string;
    tracestate?: string;
  };

  /**
   * Extract span name from attributes
   *
   * @example
   * ```typescript
   * // HTTP server: "GET /users/:id"
   * extractSpanName: (attrs) => `${attrs["http.request.method"]} ${attrs["url.path"]}`
   *
   * // Fetch client: Just method name for low cardinality
   * extractSpanName: (attrs) => attrs["http.request.method"] || "GET"
   * ```
   */
  extractSpanName?: (attributes: Record<string, any>) => string;

  /**
   * Extract span kind from attributes
   *
   * @default SpanKind.INTERNAL
   */
  extractSpanKind?: (attributes: Record<string, any>) => number;

  /**
   * Determine if span represents an error based on attributes
   *
   * @example
   * ```typescript
   * // HTTP server: 5xx is error
   * isError: (attrs) => (attrs["http.response.status_code"] ?? 0) >= 500
   *
   * // HTTP client: 4xx and 5xx are errors
   * isError: (attrs) => (attrs["http.response.status_code"] ?? 0) >= 400
   * ```
   */
  isError?: (attributes: Record<string, any>) => boolean;
}
