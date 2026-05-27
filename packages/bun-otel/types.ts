/**
 * Internal type definitions for bun-otel SDK.
 *
 * This file provides numeric enums and module augmentation to extend the Bun.telemetry
 * namespace with internal nativeHooks APIs. These types are NOT exported from the package
 * and should only be used by bun-otel internal implementation files.
 *
 * @internal
 * @module
 */

/**
 * Numeric enum for configuration property identifiers.
 *
 * Used to access header capture/propagation configuration via nativeHooks.
 * Maps 1:1 with src/telemetry/config.zig ConfigurationProperty enum.
 *
 * @internal
 */
export enum ConfigurationProperty {
  /** Reserved (always undefined) */
  RESERVED = 0,
  /** HTTP server request headers to capture */
  http_capture_headers_server_request = 1,
  /** HTTP server response headers to capture */
  http_capture_headers_server_response = 2,
  /** HTTP server response headers to inject/propagate */
  http_propagate_headers_server_response = 3,
  /** Fetch client request headers to capture */
  http_capture_headers_fetch_request = 4,
  /** Fetch client response headers to capture */
  http_capture_headers_fetch_response = 5,
  /** Fetch client request headers to inject/propagate */
  http_propagate_headers_fetch_request = 6,
}

/**
 * Module augmentation: extend Bun's exported `telemetry` namespace with internal nativeHooks API.
 *
 * IMPORTANT: We use `declare module "bun"` instead of `declare global { namespace Bun { ... } }`
 * because Bun's global identifier is introduced via an `export import Bun = BunModule;` alias in
 * `bun.ns.d.ts`. Re-declaring `namespace Bun` at global scope causes a duplicate identifier error.
 *
 * By augmenting the "bun" module, we safely merge with the existing exported `telemetry` namespace
 * defined in `packages/bun-types/telemetry.d.ts` without colliding with the global alias.
 *
 * These APIs are intentionally marked `@internal`; they are for bridge code in Bun itself and
 * not part of the user-facing public API surface.
 */
declare module "bun" {
  export namespace telemetry {
    /**
     * Returns the nativeHooks object if telemetry is enabled, undefined otherwise.
     *
     * This provides zero-cost abstraction - when telemetry is disabled, the optional
     * chain short-circuits immediately without allocating hook parameters.
     *
     * Usage: `Bun.telemetry.nativeHooks()?.notifyStart(kind, id, attributes)`
     *
     * Mirrors Zig pattern: `if (telemetry.enabled()) |otel| { ... }`
     *
     * @returns NativeHooks object if telemetry enabled, undefined if disabled
     * @internal
     */
    function nativeHooks(): NativeHooks | undefined;
  }
}
/**
 * Internal native hooks for TypeScript telemetry bridges.
 *
 * This namespace provides a low-level bridge between Zig native code and TypeScript
 * semantic convention handlers (src/js/internal/telemetry_*.ts).
 *
 * Architecture:
 * ```
 * Bun Native Code (server.zig, fetch.zig)
 *   ↓ Calls TypeScript bridge
 * TypeScript Bridge (telemetry_http.ts, telemetry_fetch.ts)
 *   ↓ Uses nativeHooks
 * Bun.telemetry.nativeHooks (this API)
 *   ↓ Dispatches to instruments
 * Registered Instruments (via Bun.telemetry.attach)
 * ```
 *
 * @internal
 * @see https://github.com/oven-sh/bun/blob/main/specs/001-opentelemetry-support/contracts/native-hooks-api.md
 */
export type NativeHooks = {
  /**
   * Fast check if any instruments are registered for an operation kind.
   *
   * Used at the top of every bridge function for early return when no
   * instruments are active, avoiding expensive attribute building.
   *
   * Performance:
   * - O(1) array length check
   * - ~5ns overhead
   *
   * @param kind - Numeric InstrumentKind enum value (0-5)
   * @returns true if at least one instrument registered for this kind
   *
   * @example
   * ```typescript
   * import { InstrumentKind } from "./types"; // bun-otel internal
   *
   * // src/js/internal/telemetry_http.ts
   * export function handleIncomingRequest(req, res) {
   *   // Early return if no HTTP instruments registered
   *   if (!Bun.telemetry.nativeHooks()?.isEnabledFor(InstrumentType.HTTP)) {
   *     return;
   *   }
   *
   *   // Continue with expensive attribute building...
   * }
   * ```
   *
   * @internal
   */
  isEnabledFor(kind: number): boolean;

  /**
   * Notify all registered instruments of an operation start.
   *
   * Iterates through all instruments registered for the given kind and calls
   * their onOperationStart(id, attributes) hooks. Errors in hooks are caught
   * and logged; execution continues.
   *
   * @param kind - Numeric InstrumentKind enum value
   * @param id - Unique operation ID (from performance.now() * 1_000_000 | 0)
   * @param attributes - Semantic convention attributes
   *
   * @example
   * ```typescript
   * import { InstrumentKind } from "./types";
   *
   * const operationId = (performance.now() * 1_000_000) | 0;
   * const attributes = {
   *   "operation.id": operationId,
   *   "http.request.method": "GET",
   *   "url.path": "/api/users",
   *   // ... additional semantic convention attributes
   * };
   * Bun.telemetry.nativeHooks()?.notifyStart(InstrumentKinds.HTTP, operationId, attributes);
   * ```
   *
   * @internal
   */
  notifyStart(kind: number, id: number, attributes: Record<string, any>): void;

  /**
   * Notify all registered instruments of an operation completion.
   *
   * id must match a previous notifyStart call.
   * Attributes should include final state (status codes, response headers, etc.)
   *
   * @param kind - Numeric InstrumentKind enum value
   * @param id - Same operation ID from notifyStart
   * @param attributes - Final attributes including result data
   *
   * @example
   * ```typescript
   * import { InstrumentKind } from "./types";
   *
   * res.once("finish", () => {
   *   const attributes = {
   *     "operation.id": operationId,
   *     "http.response.status_code": 200,
   *     "http.response.body.size": 1024,
   *     // ... additional response attributes
   *   };
   *   Bun.telemetry.nativeHooks()?.notifyEnd(InstrumentKinds.HTTP, operationId, attributes);
   * });
   * ```
   *
   * @internal
   */
  notifyEnd(kind: number, id: number, attributes: Record<string, any>): void;

  /**
   * Notify all registered instruments of an operation error.
   *
   * Should be called INSTEAD of (not in addition to) notifyEnd.
   * Error attributes follow OpenTelemetry error semantic conventions.
   *
   * @param kind - Numeric InstrumentKind enum value
   * @param id - Same operation ID from notifyStart
   * @param attributes - Error details following semantic conventions
   *
   * @example
   * ```typescript
   * import { InstrumentKind } from "./types";
   *
   * res.once("error", (err: unknown) => {
   *   const attributes = {
   *     "operation.id": operationId,
   *     "error.type": "Error",
   *     "exception.message": "Connection reset",
   *     "exception.stacktrace": String(err?.stack || ""),
   *     // ... additional error context
   *   };
   *   Bun.telemetry.nativeHooks()?.notifyError(InstrumentKinds.HTTP, operationId, attributes);
   * });
   * ```
   *
   * @internal
   */
  notifyError(kind: number, id: number, attributes: Record<string, any>): void;

  /**
   * Notify all registered instruments of intermediate operation progress.
   *
   * Can be called multiple times per operation between notifyStart and notifyEnd/Error.
   * Optional - not all operations have progress events.
   *
   * @param kind - Numeric InstrumentKind enum value
   * @param id - Same operation ID from notifyStart
   * @param attributes - Progress-specific attributes
   *
   * @example
   * ```typescript
   * import { InstrumentKind } from "./types";
   *
   * req.on("data", (chunk: Buffer) => {
   *   bytesReceived += chunk.length;
   *   Bun.telemetry.nativeHooks()?.notifyProgress(InstrumentKinds.HTTP, operationId, {
   *     "operation.id": operationId,
   *     "http.request.body.bytes_received": bytesReceived,
   *   });
   * });
   * ```
   *
   * @internal
   */
  notifyProgress(kind: number, id: number, attributes: Record<string, any>): void;

  /**
   * Collect header injection data from all registered instruments.
   *
   * Calls onOperationInject(id, data) on all registered instruments and collects
   * non-null/non-undefined return values into an array.
   *
   * Used for distributed tracing header injection (W3C Trace Context).
   *
   * @param kind - Numeric InstrumentKind enum value
   * @param id - Operation ID
   * @param data - Context for injection (current headers, URL, etc.)
   * @returns Array of injection results from all instruments
   *
   * @example
   * ```typescript
   * import { InstrumentKind } from "./types";
   *
   * const injections = Bun.telemetry.nativeHooks()?.notifyInject(InstrumentKinds.Fetch, operationId, {
   *   "operation.id": operationId,
   *   "url.full": url.href,
   *   "http.request.method": method,
   * });
   *
   * // Merge injected headers into request
   * for (const injection of injections) {
   *   if (injection && typeof injection === "object") {
   *     for (const [key, value] of Object.entries(injection)) {
   *       headers.set(key, String(value));
   *     }
   *   }
   * }
   * ```
   *
   * @internal
   */
  notifyInject(kind: number, id: number, data?: Record<string, any>): any[];

  /**
   * Retrieve a configuration property value by its enum ID.
   *
   * Configuration properties store header capture/propagation settings.
   * Typically returns an array of strings (header names) or undefined.
   *
   * @param propertyId - Numeric ConfigurationProperty enum value (1-6)
   * @returns Configuration value (typically array of strings) or undefined
   *
   * @example
   * ```typescript
   * import { ConfigurationProperty } from "./types";
   *
   * const requestHeaders = Bun.telemetry.nativeHooks()?.getConfigurationProperty(
   *   ConfigurationProperty.http_capture_headers_server_request
   * );
   *
   * if (Array.isArray(requestHeaders)) {
   *   for (const headerName of requestHeaders) {
   *     const value = req.headers[headerName];
   *     if (value !== undefined) {
   *       attributes[`http.request.header.${headerName}`] = value;
   *     }
   *   }
   * }
   * ```
   *
   * @internal
   */
  getConfigurationProperty(propertyId: number): any;

  /**
   * Set a configuration property value, syncing both JS and native storage.
   *
   * Validates property type, unprotects old JSValue (allows GC), protects new
   * JSValue (prevents GC), and syncs native bun.String array from JS array.
   *
   * Validation:
   * - propertyId must be valid (1-6)
   * - Cannot set RESERVED (0)
   * - Value must be undefined, null, or array
   * - Array items must be strings
   * - Strings are converted to lowercase
   *
   * @param propertyId - Numeric ConfigurationProperty enum value (1-6)
   * @param value - New value (typically array of strings, or undefined to clear)
   * @throws {TypeError} If validation fails
   * @throws {Error} If failed to set configuration property
   *
   * @example
   * ```typescript
   * import { ConfigurationProperty } from "./types";
   *
   * const captureHeaders = ["content-type", "user-agent"];
   * Bun.telemetry.nativeHooks()?.setConfigurationProperty(
   *   ConfigurationProperty.http_capture_headers_server_request,
   *   captureHeaders
   * );
   * ```
   *
   * @internal
   */
  setConfigurationProperty(propertyId: number, value: any): void;

  /**
   * Get header injection configuration for an operation kind.
   *
   * Returns the cached list of header keys that instruments will inject
   * for the given operation kind.
   *
   * @param kind - Numeric InstrumentKind enum value
   * @returns Object with request and response header arrays, or null if no instruments inject headers
   *
   * @example
   * ```typescript
   * import { InstrumentKind } from "./types";
   *
   * const config = Bun.telemetry.nativeHooks()?.getInjectHeaders(InstrumentKinds.HTTP);
   * if (config) {
   *   console.log("Response headers:", config.response); // ["traceparent", "tracestate"]
   *   console.log("Request headers:", config.request);   // []
   * }
   * ```
   *
   * @internal
   */
  getInjectHeaders(kind: number): { request: string[]; response: string[] } | null;
};

export {};
