/**
 * OpenTelemetry instrumentation types for Bun runtime
 * @module @bun/otel/types
 */

/**
 * Categorizes operation types for routing telemetry data to appropriate handlers.
 * Maps 1:1 with the Zig InstrumentKind enum in src/bun.js/telemetry.zig
 */
export enum InstrumentKind {
  Custom = 0,
  HTTP = 1,
  Fetch = 2,
  SQL = 3,
  Redis = 4,
  S3 = 5,
}

/**
 * User-facing API for registering instrumentations with Bun's native telemetry hooks.
 * Instruments receive lifecycle callbacks during operations (HTTP requests, fetch calls, etc.)
 */
export interface NativeInstrument {
  /** Operation category this instrument handles */
  type: InstrumentKind;

  /** Human-readable name for this instrumentation */
  name: string;

  /** Semantic version of this instrumentation */
  version: string;

  /**
   * Called when an operation starts (e.g., HTTP request received, fetch initiated)
   * @param id - Unique operation ID (for correlating with onOperationEnd/Error)
   * @param info - Operation-specific data (method, url, headers, etc.)
   */
  onOperationStart?: (id: number, info: any) => void;

  /**
   * Called during long-running operations to report progress (e.g., metrics sampling)
   * @param id - Operation ID from onOperationStart
   * @param attributes - Progress-specific attributes
   */
  onOperationProgress?: (id: number, attributes: any) => void;

  /**
   * Called when an operation completes successfully
   * @param id - Operation ID from onOperationStart
   * @param result - Operation result (status code, response headers, etc.)
   */
  onOperationEnd?: (id: number, result: any) => void;

  /**
   * Called when an operation fails
   * @param id - Operation ID from onOperationStart
   * @param error - Error information (error type, message, stack trace)
   */
  onOperationError?: (id: number, error: any) => void;

  /**
   * Called to inject context into outgoing operations (e.g., trace headers for fetch)
   * @param id - Operation ID from onOperationStart
   * @param data - Optional context data
   * @returns Headers object to inject, or void
   */
  onOperationInject?: (id: number, data?: unknown) => unknown;

  /**
   * Internal state storage for instrumentation implementations
   * (Not accessed by Bun runtime, available for instrumentation use)
   */
  _internalApi?: object | null;
}

/**
 * Information returned by Bun.telemetry.listInstruments()
 */
export interface InstrumentInfo {
  id: number;
  kind: InstrumentKind;
  name: string;
  version: string;
}

/**
 * Active span context for logging integration
 */
export interface ActiveSpanContext {
  traceId: string;
  spanId: string;
}

/**
 * Configuration options for HTTP instrumentation
 */
export interface HttpInstrumentationConfig {
  /** Headers to capture from requests */
  requestHeaders?: string[];
  /** Headers to capture from responses */
  responseHeaders?: string[];
}

/**
 * Global Bun.telemetry namespace (added by native runtime)
 */
declare global {
  namespace Bun {
    namespace telemetry {
      /**
       * Register an instrumentation with the native runtime
       * @param instrument - Instrumentation object implementing NativeInstrument
       * @returns Unique instrument ID for later detachment
       */
      function attach(instrument: NativeInstrument): number;

      /**
       * Unregister an instrumentation
       * @param id - Instrument ID returned by attach()
       * @returns true if instrument was found and removed
       */
      function detach(id: number): boolean;

      /**
       * List all registered instruments
       * @param kind - Optional filter by InstrumentKind
       * @returns Array of instrument info
       */
      function listInstruments(kind?: InstrumentKind): InstrumentInfo[];

      /**
       * Get the active span context (for logging integration)
       * @returns Span context if within traced operation, null otherwise
       */
      function getActiveSpan(): ActiveSpanContext | null;

      /**
       * Check if telemetry is enabled for a given operation kind
       * @param kind - Operation category
       * @returns true if at least one instrument is attached for this kind
       */
      function isEnabledFor(kind: InstrumentKind): boolean;
    }
  }
}
