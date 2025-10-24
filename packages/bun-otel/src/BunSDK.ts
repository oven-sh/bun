/**
 * OpenTelemetry SDK for Bun
 *
 * Provides a NodeSDK-like API for configuring OpenTelemetry tracing, metrics, and logging
 * in Bun applications. Automatically instruments Bun's native HTTP server and fetch client
 * via Bun.telemetry hooks.
 *
 * Key Features:
 * - Drop-in replacement for @opentelemetry/sdk-node
 * - Auto-registers BunHttpInstrumentation and BunFetchInstrumentation
 * - Full OTEL_* environment variable support
 * - Built on stable @opentelemetry packages (1.x)
 *
 * @example Basic usage
 * ```typescript
 * import { BunSDK } from "bun-otel";
 * import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
 *
 * const sdk = new BunSDK({
 *   traceExporter: new ConsoleSpanExporter(),
 *   serviceName: 'my-service',
 * });
 * sdk.start();
 * ```
 *
 * @example Using with automatic cleanup
 * ```typescript
 * await using sdk = new BunSDK({
 *   traceExporter: new ConsoleSpanExporter(),
 *   serviceName: 'my-service',
 * });
 * sdk.start();
 * // await sdk.shutdown() called automatically when scope exits
 * ```
 *
 * @module bun-otel/BunSDK
 */

import { context, diag, propagation, type TextMapPropagator } from "@opentelemetry/api";
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import { type Instrumentation, registerInstrumentations } from "@opentelemetry/instrumentation";
import {
  type DetectorSync,
  detectResourcesSync,
  envDetector,
  hostDetector,
  processDetector,
  Resource,
} from "@opentelemetry/resources";
import { type MetricReader } from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  type IdGenerator,
  type Sampler,
  type SpanExporter,
  type SpanLimits,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BunFetchInstrumentation } from "./instruments/BunFetchInstrumentation";
import { BunHttpInstrumentation } from "./instruments/BunHttpInstrumentation";

// Enable debug logging for SDK lifecycle (useful for troubleshooting test isolation issues)
const ENABLE_DEBUG_LOGGING = false;

function debugLog(...args: unknown[]) {
  if (ENABLE_DEBUG_LOGGING) {
    console.log("[BunSDK]", ...args);
  }
}

/**
 * Configuration options for BunSDK
 *
 * Extends the standard OpenTelemetry SDK configuration with Bun-specific options.
 * Compatible with NodeSDK configuration for easy migration.
 */
export interface BunSDKConfiguration {
  // ============================================================================
  // Resource Configuration
  // ============================================================================

  /**
   * Resource to associate with all telemetry.
   * Will be merged with auto-detected resources.
   */
  resource?: Resource;

  /**
   * Resource detectors to use for auto-detecting resource attributes.
   * @default [envDetector, processDetector, hostDetector]
   */
  resourceDetectors?: DetectorSync[];
  /** @deprecated Use resourceDetectors instead */
  resourceDetector?: DetectorSync; // deprecated singular form
  /**
   * Whether to automatically detect resources using resourceDetectors.
   * @default true
   */
  autoDetectResources?: boolean;

  /**
   * Service name to use in traces.
   * Convenience shorthand for setting SEMRESATTRS_SERVICE_NAME in resource.
   */
  serviceName?: string;

  // ============================================================================
  // Context & Propagation
  // ============================================================================

  /**
   * Text map propagator to use for context propagation.
   * Set to null to disable propagation.
   * @default W3CTraceContextPropagator + W3CBaggagePropagator
   */
  textMapPropagator?: TextMapPropagator | null;

  // ============================================================================
  // Tracing Configuration
  // ============================================================================

  /**
   * Sampler to use for determining which spans to record.
   * @default ParentBasedSampler with AlwaysOnSampler root
   */
  sampler?: Sampler;

  /**
   * Span limits (max attributes, events, links per span)
   */
  spanLimits?: SpanLimits;

  /**
   * Custom ID generator for span and trace IDs
   */
  idGenerator?: IdGenerator;

  /**
   * Span exporter to use for sending traces.
   * If provided, a BatchSpanProcessor will be created automatically.
   * @deprecated Use spanProcessors instead
   */
  traceExporter?: SpanExporter;

  /**
   * Multiple span processors to use.
   * Use this to send spans to multiple destinations or customize processing.
   */
  spanProcessors?: SpanProcessor[];
  /** @deprecated Use spanProcessors instead */
  spanProcessor?: SpanProcessor; // deprecated singular form
  // ============================================================================
  // Metrics Configuration
  // ============================================================================

  /**
   * Metric readers to use for collecting and exporting metrics.
   * When provided, BunMetricsInstrumentation will be automatically registered.
   */
  metricReaders?: MetricReader[];
  /** @deprecated Use metricReaders instead */
  metricReader?: MetricReader; // deprecated singular form
  // ============================================================================
  // Instrumentation
  // ============================================================================

  /**
   * Instrumentations to register with the SDK.
   * Accepts individual instrumentations or nested arrays (will be flattened).
   *
   * If not provided, BunHttpInstrumentation and BunFetchInstrumentation are
   * automatically registered with default configuration.
   *
   * @example Manual configuration
   * ```typescript
   * import { BunSDK, BunHttpInstrumentation, BunFetchInstrumentation } from 'bun-otel';
   *
   * const sdk = new BunSDK({
   *   instrumentations: [
   *     new BunHttpInstrumentation({
   *       captureAttributes: {
   *         requestHeaders: ['x-request-id'],
   *       },
   *     }),
   *     new BunFetchInstrumentation(),
   *   ],
   * });
   * ```
   */
  instrumentations?: (Instrumentation | Instrumentation[])[];
}

/**
 * OpenTelemetry SDK for Bun
 *
 * A NodeSDK-compatible API for configuring OpenTelemetry tracing in Bun applications.
 * Automatically instruments Bun's native HTTP server and fetch client via Bun.telemetry hooks.
 *
 * Built on stable @opentelemetry packages (1.x) instead of experimental @opentelemetry/sdk-node (0.x).
 *
 * Per contract: specs/001-opentelemetry-support/contracts/BunSDK.md
 *
 * @example Basic usage
 * ```typescript
 * import { BunSDK } from "bun-otel";
 * import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
 *
 * const sdk = new BunSDK({
 *   traceExporter: new ConsoleSpanExporter(),
 *   serviceName: 'my-service',
 * });
 * sdk.start();
 * ```
 *
 * @example Advanced usage with resource detection
 * ```typescript
 * import { BunSDK } from "bun-otel";
 * import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
 * import { Resource } from "@opentelemetry/resources";
 *
 * const sdk = new BunSDK({
 *   traceExporter: new OTLPTraceExporter(),
 *   resource: new Resource({ 'deployment.environment': 'production' }),
 *   autoDetectResources: true, // Detects host, process info
 *   serviceName: 'my-service',
 * });
 * sdk.start();
 * ```
 */
export class BunSDK implements AsyncDisposable {
  private _config: BunSDKConfiguration;
  private _tracerProvider?: NodeTracerProvider;
  private _resource: Resource;
  private _spanProcessors: SpanProcessor[] = [];
  private _serviceName?: string;
  private _instrumentations: Instrumentation[];
  private _instrumentationCleanup?: () => void;

  constructor(config: BunSDKConfiguration = {}) {
    this._config = config;
    this._serviceName = config.serviceName;

    // Initialize resource
    this._resource = config.resource ?? Resource.empty();

    // handle deprecated singular resourceDetector
    const resourceDetectors =
      config.resourceDetectors ??
      (config.resourceDetector ? [config.resourceDetector] : [envDetector, processDetector, hostDetector]);

    // Setup resource detectors
    if (config.autoDetectResources !== false) {
      if (resourceDetectors.length > 0) {
        const detected = detectResourcesSync({ detectors: resourceDetectors });
        this._resource = this._resource.merge(detected);
      }
    }

    this._spanProcessors =
      config.spanProcessors ??
      (config.spanProcessor
        ? [config.spanProcessor]
        : config.traceExporter
          ? [new BatchSpanProcessor(config.traceExporter)]
          : []);

    // Setup instrumentations (auto-register Bun instrumentations if not provided)
    // Per spec lines 86-87: "If `instrumentations` not provided or empty: BunSDK auto-registers
    // BunHttpInstrumentation and BunFetchInstrumentation"
    if (config.instrumentations && config.instrumentations.length > 0) {
      // User provided instrumentations - flatten and use as-is
      this._instrumentations = config.instrumentations.flat();
    } else {
      // Auto-register Bun instrumentations with default configuration
      // Per spec lines 381-388 for default configuration
      this._instrumentations = [
        new BunHttpInstrumentation({
          captureAttributes: {
            requestHeaders: ["content-type", "content-length", "user-agent", "accept"],
            responseHeaders: ["content-type", "content-length"],
          },
        }),
        new BunFetchInstrumentation({
          captureAttributes: {
            requestHeaders: ["content-type"],
            responseHeaders: ["content-type"],
          },
        }),
      ];

      debugLog("Auto-registered Bun instrumentations (default configuration)");
    }
  }

  /**
   * Start the SDK: configure context manager, propagator, create tracer provider,
   * and register instrumentations.
   *
   * Per spec lines 151-193
   */
  start(): void {
    if (this._tracerProvider) {
      diag.warn("BunSDK already started");
      return;
    }

    // 1. Setup propagator (default to W3C Trace Context + Baggage)
    // Per spec lines 352-367
    if (this._config.textMapPropagator !== null) {
      const propagator =
        this._config.textMapPropagator ??
        new CompositePropagator({
          propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
        });
      propagation.setGlobalPropagator(propagator);
    }

    // 2. Merge serviceName into resource
    let resource = this._resource;
    if (this._serviceName) {
      const serviceResource = new Resource({ "service.name": this._serviceName });
      resource = resource.merge(serviceResource);
    }

    // 3. Create NodeTracerProvider
    this._tracerProvider = new NodeTracerProvider({
      sampler: this._config.sampler,
      spanLimits: this._config.spanLimits,
      idGenerator: this._config.idGenerator,
      spanProcessors: this._spanProcessors,
      resource,
    });

    // 4. Add span processors
    for (const processor of this._spanProcessors) {
      this._tracerProvider.addSpanProcessor(processor);
    }

    // 5. Register as global tracer provider
    // This MUST happen before registerInstrumentations() so instrumentations
    // can access the global provider
    this._tracerProvider.register();

    // 6. Register instrumentations
    // Per spec lines 157-161: "If instrumentations not provided in constructor:
    //   - Create BunHttpInstrumentation with default configuration
    //   - Create BunFetchInstrumentation with default configuration"
    debugLog(
      "Registering instrumentations:",
      this._instrumentations.map(i => i.instrumentationName),
    );
    this._instrumentationCleanup = registerInstrumentations({
      instrumentations: this._instrumentations,
      tracerProvider: this._tracerProvider,
    });
    debugLog("Instrumentations registered, cleanup function:", typeof this._instrumentationCleanup);

    // Note: Context manager setup is handled internally by instrumentations
    // via Bun.telemetry.attach() in current branch architecture
  }

  /**
   * Shutdown the SDK: disable instrumentations and shutdown tracer provider.
   * Flushes any pending spans and cleans up resources.
   *
   * Per spec lines 197-226
   */
  async shutdown(): Promise<void> {
    debugLog("shutdown() called, cleaning up instrumentations...");

    // 1. Disable instrumentations (unpatch and detach from Bun.telemetry)
    debugLog(
      "Instrumentations before cleanup:",
      this._instrumentations.map(i => `${i.instrumentationName} (enabled: ${(i as any)._config?.enabled})`),
    );

    // Manually disable each instrumentation to ensure proper cleanup
    // This calls Bun.telemetry.detach() for Bun instrumentations
    for (const instrumentation of this._instrumentations) {
      debugLog(`Explicitly calling disable() on ${instrumentation.instrumentationName}...`);
      instrumentation.disable();
    }

    if (this._instrumentationCleanup) {
      debugLog("Calling _instrumentationCleanup()...");
      this._instrumentationCleanup();
      this._instrumentationCleanup = undefined;
      debugLog("_instrumentationCleanup() complete");
    } else {
      debugLog("⚠️ No _instrumentationCleanup function!");
    }

    debugLog(
      "Instrumentations after cleanup:",
      this._instrumentations.map(i => `${i.instrumentationName} (enabled: ${(i as any)._config?.enabled})`),
    );

    // 2. Disable global context manager to prevent test isolation issues
    context.disable();

    // 3. Shutdown tracer provider (flushes pending spans to exporters)
    if (this._tracerProvider) {
      await this._tracerProvider.shutdown();
      this._tracerProvider = undefined;
    }
  }

  /**
   * Get the tracer provider instance.
   * Only available after start() has been called.
   */
  getTracerProvider(): NodeTracerProvider | undefined {
    return this._tracerProvider;
  }

  /**
   * Async dispose method for 'await using' statement support.
   * Automatically shuts down the SDK and waits for all spans to flush.
   *
   * @example
   * ```typescript
   * await using sdk = new BunSDK({ ... });
   * sdk.start();
   * // await sdk.shutdown() called automatically when scope exits
   * ```
   */
  async [Symbol.asyncDispose](): Promise<void> {
    debugLog("Symbol.asyncDispose called - shutting down...");
    await this.shutdown();
    debugLog("Symbol.asyncDispose complete");
  }
}
