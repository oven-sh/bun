declare module "bun" {
  /**
   * Telemetry API for application observability and OpenTelemetry support.
   *
   * The telemetry API provides lightweight request tracking with minimal overhead.
   * It uses numeric request IDs (u64) for efficient tracking and allows you to
   * hook into various points of the request lifecycle.
   *
   * @example
   * ```ts
   * Bun.telemetry.configure({
   *   onRequestStart(id, request) {
   *     console.log(`Request ${id} started: ${request.method} ${request.url}`);
   *   },
   *   onRequestEnd(id) {
   *     console.log(`Request ${id} ended`);
   *   },
   *   onRequestError(id, error) {
   *     console.error(`Request ${id} failed:`, error);
   *   },
   *   onResponseHeaders(id, statusCode, contentLength, headers) {
   *     console.log(`Request ${id} response status: ${statusCode}`);
   *     // Optional headers parameter available in 4th position
   *     if (headers) {
   *       console.log('Response headers:', headers);
   *     }
   *   }
   * });
   * ```
   */
  export namespace telemetry {
    /**
     * A unique numeric identifier for a request.
     * This is a lightweight u64 that's used to track requests through their lifecycle.
     */
    type RequestId = number;

    /**
     * Request-like type for different server implementations.
     * Can be either a Bun Request object (from Bun.serve) or a Node.js IncomingMessage
     * (from http.createServer), allowing the same telemetry to work with both APIs.
     */
    type RequestLike = Request | import("http").IncomingMessage;

    /**
     * Minimal headers interface that can be implemented by both native objects and Headers.
     * Designed to work with OpenTelemetry's TextMapGetter for header extraction.
     *
     * Can be either:
     * - Bun-style: Object with get(name) and keys() methods (like Headers)
     * - Node-style: Plain object with header key-value pairs
     */
    type HeadersLike =
      | { get(name: string): string | null; keys(): string[] } // Bun-style (Headers-like)
      | Record<string, string | string[] | undefined>; // Node-style (plain object)

    /**
     * Configuration options for telemetry callbacks.
     */
    interface TelemetryConfig {
      /**
       * Called when a request starts.
       *
       * @param id - Unique identifier for this request
       * @param request - The incoming Request object or IncomingMessage
       */
      onRequestStart?: (id: RequestId, request: RequestLike) => void;

      /**
       * Called when a request ends successfully.
       *
       * @param id - The request identifier
       */
      onRequestEnd?: (id: RequestId) => void;

      /**
       * Called when a request encounters an error.
       *
       * @param id - The request identifier
       * @param error - The error that occurred
       */
      onRequestError?: (id: RequestId, error: unknown) => void;

      /**
       * Called when response headers are about to be sent.
       * This is useful for capturing response metadata for tracing.
       *
       * @param id - The request identifier
       * @param statusCode - The HTTP response status code
       * @param contentLength - The response content length in bytes (0 if not set)
       * @param headers - Optional response headers object (available as 4th parameter)
       *                  Supports both Headers instances and plain objects
       */
      onResponseHeaders?: (id: RequestId, statusCode: number, contentLength: number, headers?: HeadersLike) => void;
    }

    /**
     * Configure telemetry callbacks for request tracking.
     *
     * Telemetry can only be configured once. Attempting to call configure() again
     * will throw an error. To reconfigure, you must first reset by calling
     * `Bun.telemetry.configure(null)`.
     *
     * @param config - The telemetry configuration with lifecycle callbacks, or null to reset
     * @throws {TypeError} If telemetry is already configured and config is not null
     *
     * @example
     * ```ts
     * const requestMap = new Map();
     *
     * // Initial configuration
     * Bun.telemetry.configure({
     *   onRequestStart(id, request) {
     *     requestMap.set(id, {
     *       method: request.method,
     *       url: request.url,
     *       startTime: Date.now()
     *     });
     *   },
     *   onRequestEnd(id) {
     *     const data = requestMap.get(id);
     *     if (data) {
     *       const duration = Date.now() - data.startTime;
     *       console.log(`Request ${id} took ${duration}ms`);
     *       requestMap.delete(id);
     *     }
     *   }
     * });
     *
     * // Reset and reconfigure
     * Bun.telemetry.configure(null); // Clears all callbacks
     * Bun.telemetry.configure({ ... }); // Now OK
     * ```
     */
    export function configure(config: TelemetryConfig | null): void;

    /**
     * Check if telemetry is currently enabled.
     *
     * @returns true if telemetry is enabled, false otherwise
     */
    export function isEnabled(): boolean;

    /**
     * Disable telemetry and clear all callbacks.
     * This stops all telemetry tracking and frees associated resources.
     * After calling disable(), you can reconfigure telemetry by calling configure() again.
     */
    export function disable(): void;

    /**
     * Generate a unique request ID for telemetry tracking.
     *
     * This is primarily used internally by the Node.js compatibility layer to generate
     * request IDs for http.createServer(). In most cases, you should use Bun.telemetry.configure()
     * which automatically generates IDs for you.
     *
     * @returns A unique numeric request ID
     *
     * @example
     * ```ts
     * const id = Bun.telemetry.generateRequestId();
     * console.log(`Generated request ID: ${id}`);
     * ```
     */
    export function generateRequestId(): RequestId;
  }
}
