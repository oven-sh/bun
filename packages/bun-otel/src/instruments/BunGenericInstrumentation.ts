/**
 * Generic instrumentation for Bun native operations
 *
 * Takes declarative config, creates OtelCapabilities, attaches to Bun.telemetry
 *
 * NO direct OTel imports - everything via OtelCapabilities interface!
 */

import type { ContextManager, MeterProvider, TracerProvider } from "@opentelemetry/api";
import type { Instrumentation, InstrumentationConfig } from "@opentelemetry/instrumentation";
import type { InstrumentRef, NativeInstrument } from "bun";
import type { CapabilitiesConfig, OtelCapabilities } from "../capabilities";
import { OtelCapabilitiesImpl } from "./OtelCapabilitiesImpl";

/**
 * Configuration for BunGenericInstrumentation
 */
export interface BunGenericInstrumentationConfig extends CapabilitiesConfig, InstrumentationConfig {
  /** Instrumentation name (e.g., "bun-http") */
  name: string;

  /** Instrumentation version */
  version: string;

  /** Native instrument type */
  type: "http" | "fetch" | "node" | "custom";

  /** Is this instrumentation enabled? */
  enabled?: boolean;
}

/**
 * Providers for instrumentation
 */
export interface InstrumentationProviders {
  tracerProvider?: TracerProvider;
  meterProvider?: MeterProvider;
  contextManager?: ContextManager;
}

/**
 * Generic instrumentation that bridges Bun.telemetry to OTel
 *
 * Usage:
 * ```typescript
 * const httpInstr = new BunGenericInstrumentation(
 *   {
 *     name: "bun-http",
 *     version: "0.1.0",
 *     type: "http",
 *     setsAsyncStorageContext: true,
 *     trace: {
 *       start: ["http.request.method", "url.path"],
 *       end: ["http.response.status_code"],
 *     },
 *     extractSpanName: (attrs) => `${attrs["http.request.method"]} ${attrs["url.path"]}`,
 *   },
 *   {
 *     tracerProvider,
 *     meterProvider,
 *     contextManager,
 *   }
 * );
 *
 * httpInstr.enable();
 * ```
 */
export class BunGenericInstrumentation implements Disposable, Instrumentation<BunGenericInstrumentationConfig> {
  readonly _config: BunGenericInstrumentationConfig;
  private _capabilities?: OtelCapabilities;
  private _instrumentRef?: InstrumentRef;
  private _enabled = false;

  // Providers (optional - gracefully degrades to noop)
  private _tracerProvider?: TracerProvider;
  private _meterProvider?: MeterProvider;
  private _contextManager?: ContextManager;

  constructor(config: BunGenericInstrumentationConfig, providers: InstrumentationProviders = {}) {
    this._config = { enabled: true, ...config };
    this._tracerProvider = providers.tracerProvider;
    this._meterProvider = providers.meterProvider;
    this._contextManager = providers.contextManager;
  }

  get instrumentationName(): string {
    return this._config.name;
  }

  get instrumentationVersion(): string {
    return this._config.version;
  }

  /**
   * Set tracer provider (optional)
   * Part of OpenTelemetry instrumentation convention
   */
  setTracerProvider(provider: TracerProvider): void {
    this._tracerProvider = provider;
  }

  /**
   * Set meter provider (optional)
   * Part of OpenTelemetry instrumentation convention
   */
  setMeterProvider(provider: MeterProvider): void {
    this._meterProvider = provider;
  }

  setConfig(_config: BunGenericInstrumentationConfig): void {
    throw new Error("setConfig() is not supported - create a new instrumentation instance with desired config");
  }

  /**
   * Enable instrumentation - attaches to Bun.telemetry
   */
  enable(): void {
    if (this._enabled || this._config.enabled === false) return;

    // Create capabilities with contextManager in config
    const configWithContext = { ...this._config, contextManager: this._contextManager };

    // Create capabilities
    this._capabilities = new OtelCapabilitiesImpl(this._config.name, this._config.version, configWithContext, {
      tracerProvider: this._tracerProvider,
      meterProvider: this._meterProvider,
    });

    // Attach to Bun.telemetry
    this._instrumentRef = Bun.telemetry.attach(this._createNativeInstrument());

    this._enabled = true;
  }

  /**
   * Disable instrumentation - detaches from Bun.telemetry
   */
  disable(): void {
    if (!this._enabled) return;

    if (this._instrumentRef) {
      Bun.telemetry.detach(this._instrumentRef);
      this._instrumentRef = undefined;
    }

    this._capabilities = undefined;
    this._enabled = false;
  }

  /**
   * Get current config
   */
  getConfig(): Readonly<BunGenericInstrumentationConfig> {
    return { ...this._config };
  }

  /**
   * Symbol.dispose for 'using' statement
   */
  [Symbol.dispose](): void {
    this.disable();
  }

  /**
   * Create NativeInstrument definition
   *
   * This is where we bridge Bun.telemetry hooks to OtelCapabilities!
   */
  protected _createNativeInstrument(): NativeInstrument {
    const caps = this._capabilities!;

    // Extract headers to capture from trace config
    const captureAttributes = this._extractCaptureAttributes();
    const injectHeaders = this._extractInjectHeaders();

    return {
      type: this._config.type,
      name: this._config.name,
      version: this._config.version,
      captureAttributes:
        captureAttributes.requestHeaders.length > 0 || captureAttributes.responseHeaders.length > 0
          ? captureAttributes
          : undefined,
      injectHeaders,

      // Bridge hooks - just pass through to capabilities!
      onOperationStart: (id, attrs) => caps.startSpan(id, attrs),

      onOperationProgress: (id, attrs) => caps.updateSpan(id, attrs),

      onOperationEnd: (id, attrs) => caps.endSpan(id, attrs),

      onOperationError: (id, attrs) => caps.errorSpan(id, attrs),

      onOperationInject: id => caps.getTraceInfo(id),
    };
  }

  /**
   * Extract headers to capture from trace config
   */
  private _extractCaptureAttributes(): { requestHeaders: string[]; responseHeaders: string[] } {
    const requestHeaders: string[] = [];
    const responseHeaders: string[] = [];

    // Extract from trace.start (request headers)
    if (this._config.trace?.start) {
      for (const attr of this._config.trace.start) {
        if (attr.startsWith("http.request.header.")) {
          requestHeaders.push(attr.replace("http.request.header.", ""));
        }
      }
    }

    // Extract from trace.update (response headers during progress)
    if (this._config.trace?.update) {
      for (const attr of this._config.trace.update) {
        if (attr.startsWith("http.response.header.")) {
          responseHeaders.push(attr.replace("http.response.header.", ""));
        }
      }
    }

    // Extract from trace.end (response headers at completion)
    if (this._config.trace?.end) {
      for (const attr of this._config.trace.end) {
        if (attr.startsWith("http.response.header.")) {
          responseHeaders.push(attr.replace("http.response.header.", ""));
        }
      }
    }

    return { requestHeaders, responseHeaders };
  }

  /**
   * Extract headers to inject (for distributed tracing)
   * Returns { request?: string[], response?: string[] }
   */
  private _extractInjectHeaders(): { request?: string[]; response?: string[] } {
    const headers = ["traceparent", "tracestate"];

    // CLIENT spans (fetch) inject into outgoing requests
    // SERVER spans (http, node) inject into responses
    if (this._config.type === "fetch") {
      return { request: headers };
    } else {
      return { response: headers };
    }
  }
}
