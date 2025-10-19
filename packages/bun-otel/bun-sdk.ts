import { context, ContextManager, diag, propagation, TextMapPropagator, trace } from "@opentelemetry/api";
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
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
export class BunSDK {
  private _config: BunSDKConfiguration;
  private _tracerProvider?: NodeTracerProvider;
  private _resource: Resource;
  private _spanProcessors: SpanProcessor[] = [];
  private _serviceName?: string;
  private _tracerName: string;
  private _spans?: Map<number, Span>;

  constructor(config: BunSDKConfiguration = {}) {
    this._config = config;
    this._serviceName = config.serviceName;
    this._tracerName = config.tracerName ?? "@bun/otel";

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

    // Setup context manager
    if (this._config.contextManager) {
      context.setGlobalContextManager(this._config.contextManager);
    }

    // Setup propagator (default to W3C Trace Context + Baggage)
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
    const { config, spans } = createBunTelemetryConfig({
      tracerProvider: this._tracerProvider,
      tracerName: this._tracerName,
      correlationHeaderName: this._config.correlationHeaderName,
      requestHeaderAttributes: this._config.requestHeaderAttributes,
      responseHeaderAttributes: this._config.responseHeaderAttributes,
    });
    this._spans = spans;
    Bun.telemetry.configure(config);
  }

  /**
   * Shutdown the SDK: end any pending spans, disable Bun telemetry, and shutdown tracer provider.
   * Flushes any pending spans and cleans up resources.
   */
  async shutdown(): Promise<void> {
    // End any pending spans before shutting down
    if (this._spans) {
      for (const span of this._spans.values()) {
        span.end();
      }
      this._spans.clear();
      this._spans = undefined;
    }

    // Disable Bun telemetry
    Bun.telemetry.disable();

    // Shutdown tracer provider (flushes pending spans to exporters)
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
}
