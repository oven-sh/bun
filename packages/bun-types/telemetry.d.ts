/**
 * OpenTelemetry instrumentation support for Bun runtime.
 *
 * This module provides a native attach/detach API for registering instrumentations
 * that receive lifecycle callbacks during operations (HTTP requests, fetch calls, etc.).
 *
 * @example
 * ```typescript
 * // Register an HTTP server instrumentation
 * const instrumentId = Bun.telemetry.attach({
 *   kind: "http",
 *   name: "@opentelemetry/instrumentation-http",
 *   version: "0.1.0",
 *
 *   captureAttributes: {
 *     requestHeaders: ["content-type", "user-agent"],
 *     responseHeaders: ["content-type"],
 *   },
 *
 *   injectHeaders: {
 *     response: ["traceparent", "tracestate"],
 *   },
 *
 *   onOperationStart(id, attributes) {
 *     console.log(`HTTP ${attributes["http.request.method"]} ${attributes["url.path"]} started`);
 *   },
 *
 *   onOperationEnd(id, attributes) {
 *     console.log(`HTTP completed with status ${attributes["http.response.status_code"]}`);
 *   },
 *
 *   onOperationInject(id, data) {
 *     // Return headers to inject for distributed tracing
 *     return {
 *       traceparent: "00-trace-id-span-id-01",
 *       tracestate: "vendor=value",
 *     };
 *   },
 * });
 *
 * // Later: unregister the instrumentation
 * Bun.telemetry.detach(instrumentId);
 * ```
 */
declare module "bun" {
  /**
   * Branded type for request IDs to prevent accidental mixing with plain numbers.
   *
   * Runtime: Just a number
   * Compile-time: Type-safe identifier for telemetry operations
   *
   * @internal Used internally by hooks - users don't create these directly
   */
  export type OpId = number & { readonly __brand: unique symbol };

  /**
   * OpenTelemetry-compatible attribute value types (primitives and arrays).
   *
   * Matches OTel semantic conventions for span/event attributes.
   * @see https://opentelemetry.io/docs/specs/otel/common/attribute-naming/
   */
  export type TelemetryAttribute = string | number | boolean;

  /**
   * Record of telemetry attributes for operation hooks.
   *
   * Values must be OTel-compatible primitives or arrays of primitives.
   */
  export type TelemetryAttributes = Record<string, TelemetryAttribute | ReadonlyArray<TelemetryAttribute>>;

  /**
   * Lowercase header name for HTTP header capture/injection.
   *
   * HTTP header names are case-insensitive per RFC 9110; lowercase enforces consistency.
   */
  export type HeaderName = Lowercase<string>;

  /**
   * Readonly list of lowercase header names.
   *
   * Used for header capture and injection configuration.
   */
  export type ReadonlyHeaderList = readonly HeaderName[];

  /**
   * Disposable-like interface for environments without lib.esnext.disposable.
   *
   * Provides Symbol.dispose for automatic cleanup without requiring specific lib configuration.
   */
  export type DisposableLike = { [Symbol.dispose](): void };

  /**
   * Reference to an attached instrument, returned by Bun.telemetry.attach().
   *
   * Implements Disposable for automatic cleanup with `using` statement:
   * ```typescript
   * using instrument = Bun.telemetry.attach({ ... });
   * // Automatically detached at scope exit
   * ```
   *
   * Can also be manually detached:
   * ```typescript
   * const instrument = Bun.telemetry.attach({ ... });
   * Bun.telemetry.detach(instrument);
   * ```
   */
  type InstrumentRef = { readonly id: number } & (Disposable | DisposableLike);

  /**
   * Categorizes operation types for routing telemetry data to appropriate handlers.
   *
   * Use string literals to specify which operations your instrumentation handles.
   * For example: `kind: "http"` instruments HTTP server operations.
   */
  type InstrumentKind = "custom" | "http" | "fetch" | "sql" | "redis" | "s3" | "node";

  /**
   * User-facing API for registering instrumentations with Bun's native telemetry hooks.
   *
   * Instruments receive lifecycle callbacks during operations with semantic convention
   * attributes following OpenTelemetry specifications.
   */
  export interface NativeInstrument {
    /**
     * Instrumentation operation category.
     *
     * Determines which internal instrumentation points will be connected to
     * the provided lifecycle callbacks.
     */
    kind: InstrumentKind;

    /**
     * Human-readable name for this instrumentation.
     *
     * Used for debugging and error messages.
     * Recommended format: @scope/package-name
     *
     * @example "@opentelemetry/instrumentation-http"
     */
    name: string;

    /**
     * Semantic version of this instrumentation.
     *
     * Must follow semver format (e.g., "1.0.0")
     */
    version: string;

    /**
     * Attribute capture configuration (optional).
     *
     * Specifies which HTTP headers to capture as span attributes.
     * Only headers explicitly listed here will be captured.
     *
     * Per RFC 9110, header names are case-insensitive and will be normalized
     * to lowercase internally. You may provide headers in any casing.
     *
     * Security: Sensitive headers (authorization, cookie, etc.) are blocked
     * even if listed here.
     */
    captureAttributes?: {
      /** HTTP request headers to capture (max 50 headers, normalized to lowercase) */
      requestHeaders?: ReadonlyHeaderList;
      /** HTTP response headers to capture (max 50 headers, normalized to lowercase) */
      responseHeaders?: ReadonlyHeaderList;
    };

    /**
     * Header injection configuration (optional).
     *
     * Declares which headers this instrument will inject for distributed tracing.
     * Header keys must be declared here; extra keys in onOperationInject return
     * values are ignored.
     *
     * Per RFC 9110, header names are case-insensitive and will be normalized
     * to lowercase internally. You may provide headers in any casing.
     *
     * Security: Sensitive headers (authorization, cookie, etc.) are blocked
     * even if listed here.
     */
    injectHeaders?: {
      /** Headers to inject into outgoing requests (for Fetch client, max 20 headers, normalized to lowercase) */
      request?: ReadonlyHeaderList;
      /** Headers to inject into outgoing responses (for HTTP server, max 20 headers, normalized to lowercase) */
      response?: ReadonlyHeaderList;
    };

    /**
     * Called when an operation starts.
     *
     * Receives semantic convention attributes describing the operation.
     * For HTTP: method, URL, headers (if configured), etc.
     * For Fetch: method, URL, headers (if configured), etc.
     *
     * MUST be synchronous (no async/await).
     * Errors are caught and logged; operation continues.
     *
     * @param id - Unique operation ID (for correlating with onOperationEnd/Error)
     * @param attributes - Operation-specific attributes following OpenTelemetry semantic conventions
     */
    onOperationStart?: (id: OpId, attributes: TelemetryAttributes) => void;

    /**
     * Called during long-running operations to report progress (optional).
     *
     * Use cases:
     * - Large file uploads/downloads (report bytes transferred)
     * - Long-running SQL queries (report rows processed)
     * - Streaming responses (report chunks sent)
     *
     * MUST be synchronous (no async/await).
     * Errors are caught and logged; operation continues.
     *
     * @param id - Operation ID from onOperationStart
     * @param attributes - Progress-specific attributes
     */
    onOperationProgress?: (id: OpId, attributes: TelemetryAttributes) => void;

    /**
     * Called when an operation completes successfully.
     *
     * Receives semantic convention attributes describing the result.
     * For HTTP: status code, response headers (if configured), body size, etc.
     * For Fetch: status code, response headers (if configured), body size, etc.
     *
     * MUST be synchronous (no async/await).
     * Errors are caught and logged; operation continues.
     *
     * @param id - Operation ID from onOperationStart
     * @param attributes - Result attributes following OpenTelemetry semantic conventions
     */
    onOperationEnd?: (id: OpId, attributes: TelemetryAttributes) => void;

    /**
     * Called when an operation fails.
     *
     * Receives semantic convention attributes describing the error.
     * Includes: error.type, error.message, error.stack, etc.
     *
     * Called INSTEAD of (not in addition to) onOperationEnd.
     *
     * MUST be synchronous (no async/await).
     * Errors are caught and logged; operation continues.
     *
     * @param id - Operation ID from onOperationStart
     * @param attributes - Error attributes following OpenTelemetry semantic conventions
     */
    onOperationError?: (id: OpId, attributes: TelemetryAttributes) => void;

    /**
     * Called to inject context into outgoing operations (optional).
     *
     * For distributed tracing: return headers to inject (traceparent, tracestate, etc.)
     * For HTTP server: headers injected into responses
     * For Fetch client: headers injected into requests
     *
     * Only header keys declared in injectHeaders are used; extra keys are ignored.
     *
     * MUST be synchronous (no async/await).
     * Errors are caught and logged; no headers injected.
     *
     * @param id - Operation ID from onOperationStart
     * @param data - Optional context data
     * @returns Headers object to inject (only keys from injectHeaders are used), or void/undefined
     *
     * @example
     * ```typescript
     * onOperationInject(id, data) {
     *   return {
     *     traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
     *     tracestate: "vendor1=value1,vendor2=value2"
     *   };
     * }
     * ```
     */
    onOperationInject?: (id: OpId, data?: unknown) => Record<string, string> | void;
  }

  /**
   * Information returned by Bun.telemetry.listInstruments()
   */
  export interface InstrumentInfo {
    /** Unique instrument ID (from attach()) */
    readonly id: number;
    /** Operation kind this instrument handles */
    kind: InstrumentKind;
    /** Instrumentation name */
    name: string;
    /** Instrumentation version */
    version: string;
  }

  /**
   * Active span context for logging integration (future)
   *
   * @experimental
   */
  export interface ActiveSpanContext {
    /** W3C Trace Context trace ID (hex string) */
    readonly traceId: string;
    /** W3C Trace Context span ID (hex string) */
    readonly spanId: string;
  }

  /**
   * Telemetry API for application observability and OpenTelemetry support.
   *
   * The telemetry API provides lightweight operation tracking with minimal overhead.
   * Instruments can be attached/detached dynamically and receive lifecycle callbacks
   * with semantic convention attributes.
   */
  export namespace telemetry {
    /**
     * Register an instrumentation with the native runtime.
     *
     * Multiple instruments can be registered for the same operation kind.
     * All registered instruments receive lifecycle callbacks in registration order.
     *
     * Validation:
     * - kind must be a valid InstrumentKind string value (e.g. "http" | "fetch" | "sql" ... etc.)
     *   Unknown string values are accepted and treated as "custom" for forward compatibility
     * - name must be a non-empty string (max 256 chars)
     * - version must be a non-empty string (semver format)
     * - At least one hook function (onOperationStart/End/Error/Progress/Inject) must be provided
     * - Hook functions must NOT be async
     * - captureAttributes header names must be lowercase (max 50 per array)
     * - injectHeaders header names must be lowercase (max 20 per array)
     * - Sensitive headers (authorization, cookie, etc.) are blocked in both capture and inject
     *
     * Side effects:
     * - Instrument registered in global Telemetry singleton
     * - JSValue references protected from garbage collection
     * - Future operations of matching type will invoke hooks
     *
     * Performance:
     * - O(1) registration time
     * - ~160 bytes memory allocation per instrument
     *
     * @param instrument - Instrumentation object implementing NativeInstrument
     * @returns InstrumentRef with disposable cleanup (use with `using` statement)
     * @throws {TypeError} If validation fails (non-string/non-number attributes, out-of-range numbers, missing required fields, async hooks, invalid headers, etc.)
     *
     * @example
     * ```typescript
     * // Automatic cleanup with using statement (recommended)
     * using instrument = Bun.telemetry.attach({
     *   kind: "http",
     *   name: "@opentelemetry/instrumentation-http",
     *   version: "0.1.0",
     *   onOperationStart(id, attributes) {
     *     console.log(`Request started: ${attributes["http.request.method"]} ${attributes["url.path"]}`);
     *   },
     *   onOperationEnd(id, attributes) {
     *     console.log(`Request completed: ${attributes["http.response.status_code"]}`);
     *   },
     * });
     * // Automatically detached at scope exit
     *
     * // Manual cleanup
     * const ref = Bun.telemetry.attach({ ... });
     * console.log(ref.id); // Access numeric ID if needed
     * Bun.telemetry.detach(ref);
     * ```
     */
    export function attach(instrument: NativeInstrument): InstrumentRef;

    /**
     * Unregister a previously attached instrumentation.
     *
     * After detaching, the instrument's hooks will no longer be invoked for
     * future operations. In-flight operations (already started) continue to completion.
     *
     * Validation:
     * - instrumentRef must be an InstrumentRef returned from attach()
     * - instrumentRef must correspond to a currently registered instrument
     * - Detaching same ref twice returns false (idempotent)
     *
     * Side effects:
     * - Instrument removed from global registry
     * - JSValue references unprotected (allows garbage collection)
     * - Future operations will NOT invoke this instrument's hooks
     *
     * Performance:
     * - O(n) where n = number of instruments for that kind (typically <10)
     * - All memory freed immediately
     *
     * @param instrumentRef - InstrumentRef returned from attach()
     * @returns true if instrument was detached, false if already detached or not found
     *
     * @example
     * ```typescript
     * const ref = Bun.telemetry.attach({ ... });
     *
     * // Later: unregister
     * Bun.telemetry.detach(ref); // returns true
     *
     * // Already detached
     * Bun.telemetry.detach(ref); // returns false
     * ```
     */
    export function detach(instrumentRef: InstrumentRef): boolean;

    /**
     * List all registered instruments (optional filter by kind).
     *
     * @param kind - Optional filter by InstrumentKind
     * @returns Array of instrument info
     *
     * @experimental - Planned future API
     */
    export function listInstruments(kind?: InstrumentKind): InstrumentInfo[];

    /**
     * Get the active span context (for logging integration).
     *
     * Returns span context if currently within a traced operation (e.g., inside
     * an HTTP request handler with an active span), otherwise returns null.
     *
     * Useful for correlating logs with traces by including traceId and spanId
     * in log output.
     *
     * @returns Span context if within traced operation, null otherwise
     *
     * @experimental - Planned future API
     */
    export function getActiveSpan(): ActiveSpanContext | null;
  }
}
