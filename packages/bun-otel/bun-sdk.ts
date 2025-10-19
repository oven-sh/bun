import { context, ContextManager, diag, propagation, type Span, TextMapPropagator, trace } from "@opentelemetry/api";
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import { Instrumentation, registerInstrumentations } from "@opentelemetry/instrumentation";
import {
  type DetectorSync,
  detectResourcesSync,
  envDetector,
  hostDetector,
  processDetector,
  Resource,
} from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  IdGenerator,
  Sampler,
  SpanExporter,
  SpanLimits,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { createBunTelemetryConfig } from "./otel-core";

/**
 * Configuration options for BunSDK
 *
 * Mirrors NodeSDK configuration but built on stable @opentelemetry/sdk-trace-* packages (1.x)
 * instead of experimental @opentelemetry/sdk-node (0.x).
 */
export interface BunSDKConfiguration {
  /**
   * Span exporter to use for sending traces.
   * If provided, a BatchSpanProcessor will be created automatically.
   */
  traceExporter?: SpanExporter;

  /**
   * Span processor to use. Takes precedence over traceExporter.
   * Use this for custom span processing logic.
   */
  spanProcessor?: SpanProcessor;

  /**
   * Multiple span processors to use. Takes precedence over spanProcessor and traceExporter.
   * Use this to send spans to multiple destinations.
   */
  spanProcessors?: SpanProcessor[];

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
   * Resource to associate with all telemetry.
   * Will be merged with auto-detected resources.
   */
  resource?: Resource;

  /**
   * Resource detectors to use for auto-detecting resource attributes.
   * @default [envDetector, processDetector, hostDetector]
   */
  resourceDetectors?: DetectorSync[];

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

  /**
   * Context manager to use for context propagation.
   * If not provided, uses the global context manager.
   */
  contextManager?: ContextManager;

  /**
   * Text map propagator to use for context propagation.
   * Set to null to disable propagation.
   * @default W3CTraceContextPropagator + W3CBaggagePropagator
   */
  textMapPropagator?: TextMapPropagator | null;

  /**
   * Name to use for the tracer when creating spans in Bun.telemetry hooks.
   * @default '@bun/otel'
   */
  tracerName?: string;

  /**
   * Name of the response correlation header to emit with the current traceId.
   * Set to false to disable emitting a correlation header.
   * @default "x-trace-id"
   */
  correlationHeaderName?: string | false;

  /**
   * Request header names to capture as span attributes (attr prefix: http.request.header.*).
   * Dashes are normalized to underscores and names are lowercased.
   */
  requestHeaderAttributes?: string[];

  /**
   * Response header names to capture as span attributes (attr prefix: http.response.header.*).
   * Dashes are normalized to underscores and names are lowercased.
   */
  responseHeaderAttributes?: string[];

  /**
   * Instrumentations to register with the SDK.
   * Accepts individual instrumentations or nested arrays (will be flattened).
   *
   * @example
   * ```typescript
   * import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
   *
   * const sdk = new BunSDK({
   *   instrumentations: [
   *     new FetchInstrumentation(),
   *   ],
   * });
   * ```
   */
  instrumentations?: (Instrumentation | Instrumentation[])[];
}
/**
 * OpenTelemetry SDK for Bun
 *
 * Provides a NodeSDK-like API for configuring OpenTelemetry tracing in Bun applications.
 * Automatically instruments Bun's native HTTP server via Bun.telemetry hooks.
 *
 * Built on stable @opentelemetry packages (1.x) instead of experimental @opentelemetry/sdk-node (0.x).
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
  private _tracerName: string;
  private _spans?: Map<number, Span>;
  private _instrumentations: Instrumentation[];
  private _instrumentationCleanup?: () => void;

  constructor(config: BunSDKConfiguration = {}) {
    this._config = config;
    this._serviceName = config.serviceName;
    this._tracerName = config.tracerName ?? "@bun/otel";

    // Flatten instrumentations array (handles nested arrays like NodeSDK)
    this._instrumentations = config.instrumentations?.flat() ?? [];

    // Initialize resource
    this._resource = config.resource ?? Resource.empty();

    // Setup resource detectors
    if (config.autoDetectResources !== false) {
      const detectors = config.resourceDetectors ?? [envDetector, processDetector, hostDetector];
      if (detectors.length > 0) {
        const detected = detectResourcesSync({ detectors });
        this._resource = this._resource.merge(detected);
      }
    }

    // Setup span processors
    if (config.spanProcessors) {
      this._spanProcessors = config.spanProcessors;
    } else if (config.spanProcessor) {
      this._spanProcessors = [config.spanProcessor];
    } else if (config.traceExporter) {
      this._spanProcessors = [new BatchSpanProcessor(config.traceExporter)];
    }
  }

  /**
   * Start the SDK: configure context manager, propagator, create tracer provider,
   * and install Bun native tracing hooks.
   */
  start(): void {
    if (this._tracerProvider) {
      diag.warn("BunSDK already started");
      return;
    }

    // 1. Register instrumentations FIRST (before setting up providers)
    // Following NodeSDK pattern - instrumentations need to be registered early
    // so they can hook into modules before they're loaded
    // Store cleanup function to disable instrumentations on shutdown
    this._instrumentationCleanup = registerInstrumentations({
      instrumentations: this._instrumentations,
    });

    // 2. Setup propagator (default to W3C Trace Context + Baggage)
    if (this._config.textMapPropagator !== null) {
      const propagator =
        this._config.textMapPropagator ??
        new CompositePropagator({
          propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
        });
      propagation.setGlobalPropagator(propagator);
    }

    // Merge serviceName into resource
    let resource = this._resource;
    if (this._serviceName) {
      const serviceResource = new Resource({ "service.name": this._serviceName });
      resource = resource.merge(serviceResource);
    }

    // Create NodeTracerProvider
    this._tracerProvider = new NodeTracerProvider({
      sampler: this._config.sampler,
      spanLimits: this._config.spanLimits,
      idGenerator: this._config.idGenerator,
      resource,
    });

    // Add span processors
    for (const processor of this._spanProcessors) {
      this._tracerProvider.addSpanProcessor(processor);
    }

    // Register as global tracer provider
    trace.setGlobalTracerProvider(this._tracerProvider);

    // Create Bun telemetry config and install it ourselves so we can hold onto spans
    const { config, spans, contextManager } = createBunTelemetryConfig({
      tracerProvider: this._tracerProvider,
      tracerName: this._tracerName,
      correlationHeaderName: this._config.correlationHeaderName,
      requestHeaderAttributes: this._config.requestHeaderAttributes,
      responseHeaderAttributes: this._config.responseHeaderAttributes,
    });
    this._spans = spans;
    Bun.telemetry.configure(config);

    // 3. Install shared context manager AFTER Bun.telemetry is configured
    // This MUST override any user-provided context manager because Bun's telemetry
    // requires a shared AsyncLocalStorage instance. The context manager returned from
    // createBunTelemetryConfig uses the same storage that Bun.telemetry writes to.
    context.setGlobalContextManager(contextManager);

    // NodeSDK workaround: Update instrumentations with TracerProvider after it's created
    // See https://github.com/open-telemetry/opentelemetry-js/issues/3609
    // Instrumentations need to be notified of the tracer provider after it's been set globally
    for (const instrumentation of this._instrumentations) {
      instrumentation.setTracerProvider(this._tracerProvider);
    }

    // BunSDK doesn't support MeterProvider yet, but when it does:
    // if (this._meterProvider) {
    //   for (const instrumentation of this._instrumentations) {
    //     instrumentation.setMeterProvider(metrics.getMeterProvider());
    //   }
    // }
  }

  /**
   * Shutdown the SDK: disable instrumentations, Bun telemetry, and shutdown tracer provider.
   * Flushes any pending spans and cleans up resources.
   */
  async shutdown(): Promise<void> {
    // 1. Disable instrumentations (unpatch fetch, http, etc.)
    if (this._instrumentationCleanup) {
      this._instrumentationCleanup();
      this._instrumentationCleanup = undefined;
    }

    // 2. Clear local span map; do not force-end in-flight spans
    if (this._spans) {
      this._spans.clear();
      this._spans = undefined;
    }

    // 3. Reset Bun telemetry (allows reconfiguration)
    Bun.telemetry.configure(null);

    // 4. Disable global context manager to prevent test isolation issues
    context.disable();

    // 5. Shutdown tracer provider (flushes pending spans to exporters)
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
    await this.shutdown();
  }
}
