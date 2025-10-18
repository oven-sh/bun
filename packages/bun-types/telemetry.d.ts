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
   *   onResponseHeaders(id, response) {
   *     console.log(`Request ${id} response status: ${response.status}`);
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
     * Configuration options for telemetry callbacks.
     */
    interface TelemetryConfig {
      /**
       * Called when a request starts.
       *
       * Accepts either a Bun Request object (from Bun.serve) or a Node.js IncomingMessage
       * (from http.createServer), allowing the same telemetry to work with both APIs.
       *
       * @param id - Unique identifier for this request
       * @param request - The incoming Request object or IncomingMessage
       */
      onRequestStart?: (id: RequestId, request: Request | import("http").IncomingMessage) => void;

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
       * Note: Currently only provides the status code to avoid lifecycle issues.
       * Full response object support may be added in a future version.
       *
       * @param id - The request identifier
       * @param statusCode - The HTTP response status code
       */
      onResponseHeaders?: (id: RequestId, statusCode: number) => void;
    }

    /**
     * Configure telemetry callbacks for request tracking.
     *
     * @param config - The telemetry configuration with lifecycle callbacks
     *
     * @example
     * ```ts
     * const requestMap = new Map();
     *
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
     * ```
     */
    export function configure(config: TelemetryConfig): void;

    /**
     * Check if telemetry is currently enabled.
     *
     * @returns true if telemetry is enabled, false otherwise
     */
    export function isEnabled(): boolean;

    /**
     * Disable telemetry and clear all callbacks.
     * This stops all telemetry tracking and frees associated resources.
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
