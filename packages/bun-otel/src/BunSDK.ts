/**
 * BunSDK2 - Clean, autowired OpenTelemetry SDK for Bun
 *
 * Key improvements:
 * - Uses BunGenericInstrumentation (no more class hierarchy!)
 * - Pure config mapping (testable in isolation)
 * - Autowires context manager, propagation, providers
 * - Works with InMemory exporters for testing
 */
import {
  context,
  diag,
  metrics,
  propagation,
  trace,
  type MeterProvider as IMeterProvider,
  type TracerProvider as ITracerProvider,
} from "@opentelemetry/api";
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  detectResources,
  emptyResource,
  envDetector,
  hostDetector,
  processDetector,
  resourceFromAttributes,
  type Resource,
} from "@opentelemetry/resources";
import { MeterProvider, type MetricReader } from "@opentelemetry/sdk-metrics";
import type { SpanExporter, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BatchSpanProcessor, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { AsyncLocalStorage } from "async_hooks";
import "../types";
import type { NodeSDKConfig } from "./config-mappers";
import { mapNodeSDKConfig } from "./config-mappers";
import { BunAsyncLocalStorageContextManager } from "./context/BunAsyncLocalStorageContextManager";
import { BunGenericInstrumentation } from "./instruments/BunGenericInstrumentation";
import { BunNodeHttpCreateServerAdapter } from "./instruments/BunNodeHttpCreateServerAdapter";
export type SupportedInstruments = "http" | "fetch" | "node";
const DEFAULT_INSTRUMENTS: SupportedInstruments[] = ["http", "fetch", "node"];

/**
 * Configuration for BunSDK2
 */
export interface BunSDK2Config extends NodeSDKConfig {
  /**
   * Service name for resource attributes
   */
  serviceName?: string;

  /**
   * Custom resource to merge with auto-detected resources
   */
  resource?: Resource;

  /**
   * Enable auto-detection of resources (host, process, env)
   * @default true
   */
  autoDetectResources?: boolean;

  /**
   * Tracer provider (optional - will be created if not provided)
   */
  tracerProvider?: ITracerProvider;

  /**
   * Meter provider (optional - will be created if not provided)
   */
  meterProvider?: IMeterProvider;

  /**
   * Span exporter for traces
   * If provided, a SimpleSpanProcessor will be created
   */
  spanExporter?: SpanExporter;

  /**
   * Span processors (alternative to spanExporter)
   */
  spanProcessors?: SpanProcessor[];

  /**
   * Metric readers for metrics
   */
  metricReaders?: MetricReader[];

  /**
   * Disable auto-start on construction
   * @default false
   */
  autoStart?: boolean;

  /**
   * Instruments to enable
   * @default ["http", "fetch", "node"]
   */
  bunInstruments?: SupportedInstruments[];
}

/**
 * Clean, autowired OpenTelemetry SDK for Bun
 *
 * @example Basic usage
 * ```typescript
 * using sdk = new BunSDK2({
 *   serviceName: "my-service",
 *   spanExporter: new ConsoleSpanExporter(),
 * });
 * // Automatically started, automatically cleaned up
 * ```
 *
 * @example Testing with InMemory exporters
 * ```typescript
 * const spanExporter = new InMemorySpanExporter();
 * const metricReader = new InMemoryMetricReader();
 *
 * using sdk = new BunSDK2({
 *   spanExporter,
 *   metricReaders: [metricReader],
 * });
 *
 * // Make requests...
 *
 * const spans = spanExporter.getFinishedSpans();
 * expect(spans).toHaveLength(1);
 * ```
 *
 * @example Custom instrumentation config
 * ```typescript
 * using sdk = new BunSDK2({
 *   http: {
 *     captureAttributes: {
 *       requestHeaders: ["x-custom"],
 *     },
 *   },
 *   fetch: {
 *     enabled: false, // Disable fetch instrumentation
 *   },
 * });
 * ```
 */
export class BunSDK implements Disposable {
  private readonly _config: BunSDK2Config;

  // Providers
  protected _tracerProvider?: NodeTracerProvider;
  protected _meterProvider?: MeterProvider;

  // Context management
  protected _contextManager?: BunAsyncLocalStorageContextManager;
  private _contextStorage?: AsyncLocalStorage<any>;

  // Instrumentations
  private readonly _instruments: BunGenericInstrumentation[] = [];
  // shutdown/cleanup
  private _shutdownOnce = false;
  private _signalHandlersRegistered = false;
  // State
  private _started = false;

  constructor(config: BunSDK2Config = {}) {
    this._config = config;

    // Auto-start unless explicitly disabled
    if (config.autoStart !== false) {
      this.start();
    }
  }

  /**
   * Start the SDK - setup providers, context, and instrumentations
   */
  start(): void {
    if (this._started) return;
    this._started = true;

    // 1. Setup context manager (shared AsyncLocalStorage)
    this._setupContext();

    // 2. Setup propagator
    this._setupPropagation();

    // 3. Setup tracer provider
    this._setupTracing();

    // 4. Setup meter provider
    this._setupMetrics();

    // 5. Create and enable instrumentations
    this._setupInstrumentations();
  }

  /**
   * Start the SDK and register system signal handlers for graceful shutdown.
   *
   * This is a convenience method that:
   * 1. Calls start() if not already started
   * 2. Registers SIGINT and SIGTERM handlers
   * 3. Ensures shutdown() is called only once even if multiple signals arrive
   * 4. Calls optional callback before shutdown
   * 5. Exits process with code 0
   *
   * Recommended for production applications to ensure proper cleanup on exit.
   *
   * @param beforeShutdown - Optional callback to run before SDK shutdown (e.g., close database connections)
   *
   * @example Basic usage
   * ```typescript
   * const sdk = new BunSDK({ traceExporter: new ConsoleSpanExporter() });
   * await sdk.startAndRegisterSystemShutdownHooks();
   * // SDK started and shutdown handlers registered
   * ```
   *
   * @example With cleanup callback
   * ```typescript
   * const sdk = new BunSDK({ traceExporter: new ConsoleSpanExporter() });
   * await sdk.startAndRegisterSystemShutdownHooks(async () => {
   *   console.log("Closing database connections...");
   *   await db.close();
   * });
   * ```
   */
  async startAndRegisterSystemShutdownHooks(beforeShutdown?: () => void | Promise<void>): Promise<void> {
    // Start SDK if not already started
    this.start();

    // Only register signal handlers once
    if (this._signalHandlersRegistered) {
      diag.verbose("Signal handlers already registered, skipping");
      return;
    }
    this._signalHandlersRegistered = true;

    // Create shutdown handler that can only run once
    const shutdownHandler = async (signal: string) => {
      // Check if already shutting down
      if (this._shutdownOnce) {
        diag.info(`${signal} received but shutdown already in progress, ignoring`);
        return;
      }
      // Set flag immediately to prevent concurrent shutdown attempts
      this._shutdownOnce = true;
      diag.debug(`\n${signal} received, shutting down gracefully...`);
      try {
        // Run user callback before SDK shutdown
        if (beforeShutdown) {
          await beforeShutdown();
        }
        // Shutdown SDK
        await this.stop();
        diag.debug("✓ Shutdown complete");
      } catch (error) {
        diag.debug("Error during shutdown:", error);
      }
    };

    // Register both SIGINT (Ctrl+C) and SIGTERM (kill) handlers
    // Both call the same handler which ensures shutdown only happens once
    process.on("SIGINT", () => shutdownHandler("SIGINT"));
    process.on("SIGTERM", () => shutdownHandler("SIGTERM"));

    diag.verbose("System shutdown hooks registered (SIGINT, SIGTERM)");
  }

  /**
   * Stop the SDK - disable instrumentations and shutdown providers
   */
  async stop(): Promise<void> {
    if (!this._started) return;

    // 1. Disable instrumentations
    for (const instr of this._instruments) {
      instr.disable();
    }
    this._instruments.length = 0;

    // 2. Disable context manager
    context.disable();

    // 3. Shutdown providers
    if (this._tracerProvider) {
      await this._tracerProvider.shutdown();
      this._tracerProvider = undefined;
    }

    if (this._meterProvider) {
      await this._meterProvider.shutdown();
      this._meterProvider = undefined;
    }

    this._started = false;
  }

  /**
   * Symbol.dispose for 'using' statement
   */
  [Symbol.dispose](): void {
    // Synchronous dispose - start async shutdown but don't await
    this.stop().catch(err => {
      console.error("Error during BunSDK2 disposal:", err);
    });
  }

  /**
   * Setup shared AsyncLocalStorage context
   */
  private _setupContext(): void {
    this._contextStorage = new AsyncLocalStorage();
    this._contextManager = new BunAsyncLocalStorageContextManager(this._contextStorage);

    context.setGlobalContextManager(this._contextManager);

    // Share with native telemetry
    const ConfigProperty = { _context_storage: 7 };
    Bun.telemetry.nativeHooks()?.setConfigurationProperty(ConfigProperty._context_storage, this._contextStorage);
  }

  /**
   * Setup W3C trace context propagation
   */
  private _setupPropagation(): void {
    const propagator = new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    });

    propagation.setGlobalPropagator(propagator);
  }

  /**
   * Build resource by merging auto-detected resources with custom resources
   */
  private _buildResource(): Resource {
    let resource = emptyResource();

    // Auto-detect resources (enabled by default)
    if (this._config.autoDetectResources !== false) {
      resource = resource.merge(
        detectResources({
          detectors: [envDetector, processDetector, hostDetector],
        }),
      );
    }

    // Merge custom resource if provided
    if (this._config.resource) {
      resource = resource.merge(this._config.resource);
    }

    // Add service name (overrides any previous service.name)
    if (this._config.serviceName) {
      resource = resource.merge(
        resourceFromAttributes({
          "service.name": this._config.serviceName,
        }),
      );
    }

    return resource;
  }

  /**
   * Setup tracing (provider + processors)
   */
  private _setupTracing(): void {
    // Use provided tracer provider or create one
    if (this._config.tracerProvider) {
      this._tracerProvider = this._config.tracerProvider as NodeTracerProvider;
    } else {
      // Determine span processors
      let spanProcessors: SpanProcessor[] = [];

      if (this._config.spanProcessors) {
        spanProcessors = this._config.spanProcessors;
      } else if (this._config.spanExporter) {
        // Use SimpleSpanProcessor for testing (synchronous)
        // Use BatchSpanProcessor for production (async batching)
        const isInMemory = this._config.spanExporter.constructor.name.includes("InMemory");
        spanProcessors = [
          isInMemory
            ? new SimpleSpanProcessor(this._config.spanExporter)
            : new BatchSpanProcessor(this._config.spanExporter),
        ];
      }

      if (spanProcessors.length > 0) {
        this._tracerProvider = new NodeTracerProvider({
          spanProcessors,
          resource: this._buildResource(),
        });
      }
    }

    // Register globally
    if (this._tracerProvider) {
      trace.setGlobalTracerProvider(this._tracerProvider);
    }
  }

  /**
   * Setup metrics (provider + readers)
   */
  private _setupMetrics(): void {
    // Use provided meter provider or create one
    if (this._config.meterProvider) {
      this._meterProvider = this._config.meterProvider as MeterProvider;
    } else if (this._config.metricReaders && this._config.metricReaders.length > 0) {
      this._meterProvider = new MeterProvider({
        readers: this._config.metricReaders,
        resource: this._buildResource(),
      });
    }

    // Register globally
    if (this._meterProvider) {
      metrics.setGlobalMeterProvider(this._meterProvider);
    }
  }

  /**
   * Setup instrumentations using config mappers
   */
  private _setupInstrumentations(): void {
    // Map NodeSDK config to generic instrument configs
    const configs = mapNodeSDKConfig(this._config);
    const enabled = this._config.bunInstruments || DEFAULT_INSTRUMENTS;
    // Prepare providers to pass to all instrumentations
    const providers = {
      tracerProvider: this._tracerProvider,
      meterProvider: this._meterProvider,
      contextManager: this._contextManager,
    };
    if (configs.http.enabled && enabled.includes("http"))
      this._instruments.push(new BunGenericInstrumentation(configs.http, providers));
    if (configs.fetch.enabled && enabled.includes("fetch"))
      this._instruments.push(new BunGenericInstrumentation(configs.fetch, providers));
    if (configs.node.enabled && enabled.includes("node"))
      this._instruments.push(new BunNodeHttpCreateServerAdapter(configs.node, providers));

    // Enable all and store
    for (const instrument of this._instruments) {
      diag.debug(`Enabling instrumentation: ${instrument.instrumentationName}`);
      instrument.enable();
    }
  }
}
