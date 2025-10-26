import {
  context,
  Context,
  Counter,
  Histogram,
  MeterProvider,
  Span,
  SpanKind,
  SpanOptions,
  SpanStatusCode,
  trace,
  Tracer,
  TracerProvider,
} from "@opentelemetry/api";
import { LoggerProvider } from "@opentelemetry/api-logs";
import type { Instrumentation, InstrumentationConfig } from "@opentelemetry/instrumentation";
import { AsyncLocalStorage } from "async_hooks";
import { InstrumentKind, InstrumentRef, NativeInstrument } from "bun";
import { ATTR_ERROR_MESSAGE, ATTR_ERROR_TYPE } from "../semconv";
export type BunInstrumentationConfig = InstrumentationConfig & {
  /**
   * Shared AsyncLocalStorage instance for context propagation.
   * Provided by BunSDK to enable trace context sharing between instrumentations.
   * @internal
   */
  contextStorage?: AsyncLocalStorage<Context>;
};

export class BunAbstractInstrumentation<T extends BunInstrumentationConfig> implements Instrumentation<T>, Disposable {
  public readonly instrumentationName: string;
  public readonly instrumentationVersion: string;
  protected _config: T;

  /// registered instrument reference from Bun.telemetry.attach()
  protected _instrumentId?: InstrumentRef;

  // providers set by InstrumentationBase.registerInstrumentations()
  protected _loggerProvider?: LoggerProvider;
  protected _tracerProvider?: TracerProvider;
  protected _meterProvider?: MeterProvider;

  // active state storage
  protected _activeSpans: Map<number, Span> = new Map();
  protected _tracer?: Tracer;
  protected _activeMetricAttributes: Map<number, Record<string, any>> = new Map();
  protected _contextStorage?: AsyncLocalStorage<Context>;

  // Metric instruments (optional - used by SERVER instrumentations)
  protected _oldHttpServerDurationHistogram?: Histogram;
  protected _stableHttpServerDurationHistogram?: Histogram;
  protected _httpServerRequestsCounter?: Counter;

  protected _configValidators: Array<(t: T) => T | undefined>;
  protected _enabledCalled = false;
  protected _nativeInstrumentDef?: NativeInstrument;

  constructor(
    name: string,
    version: string,
    kind: InstrumentKind,
    config?: T,
    validators: Array<(t: T) => T | undefined> = [],
  ) {
    this.instrumentationName = name;
    this.instrumentationVersion = version;
    this._config = config || ({ enabled: false } as T);
    this._contextStorage = config?.contextStorage;
    this._configValidators = validators;
    this._nativeInstrumentDef = { type: kind, name, version };
    this.setConfig(this._config); // does not install, because we haven't enabled()
    // Do NOT auto-enable - per OTel spec, enabled defaults to FALSE in constructor
    // registerInstrumentations() will call enable() after setting TracerProvider
  }

  public enable(): void {
    if (this._enabledCalled) {
      return;
    }
    if (typeof Bun === "undefined" || !Bun.telemetry) {
      throw new TypeError(
        "Bun.telemetry is not available. This instrumentation requires Bun runtime. " + "Install from https://bun.sh",
      );
    }
    // Mark as enabled
    this._enabledCalled = true;
    this._startupSequence();
    this._config.enabled = true;
    // To be implemented by subclasses
  }

  public disable(): void {
    if (this._enabledCalled) {
      this._config.enabled = false;
      this._shutdownSequence();
      this._enabledCalled = false;
    }
  }

  public setConfig(config: T): void {
    const prev = JSON.stringify(this._config);
    let newConfig = { ...this._config, ...structuredClone(config) };
    for (const validator of this._configValidators) {
      newConfig = validator(newConfig) ?? newConfig;
    }
    const next = JSON.stringify(newConfig);
    this._config = newConfig;
    this._markConfigDirty(prev !== next);
  }

  public getConfig(): T {
    return structuredClone(this._config);
  }

  public setLoggerProvider(loggerProvider: LoggerProvider): void {
    const needsMark = this._loggerProvider !== loggerProvider;
    this._loggerProvider = loggerProvider;
    this._markConfigDirty(needsMark);
  }

  public setMeterProvider(meterProvider: MeterProvider): void {
    const needsMark = this._meterProvider !== meterProvider;
    this._meterProvider = meterProvider;
    this._markConfigDirty(needsMark);
  }

  public setTracerProvider(tracerProvider: TracerProvider): void {
    const needsMark = this._tracerProvider !== tracerProvider;
    this._tracerProvider = tracerProvider;
    this._markConfigDirty(needsMark);
  }

  /**
   * Implement Symbol.dispose for use with `using` declarations.
   * Automatically calls disable() when the instrumentation goes out of scope.
   */
  [Symbol.dispose](): void {
    this.disable();
  }

  protected getTracer(): Tracer {
    if (this._tracer) {
      return this._tracer;
    }
    if (!this._tracer) {
      // Get tracer (use explicit provider if set, otherwise use global API)
      // Per Node.js SDK: gracefully degrades if no provider is set (uses noop tracer from global API)
      const tracer =
        this._tracerProvider?.getTracer(this.instrumentationName, this.instrumentationVersion) ||
        trace.getTracer(this.instrumentationName, this.instrumentationVersion);
      this._tracer = tracer;
    }
    return this._tracer;
  }

  ////////////////////////////////////////////// INTERNAL HELPERS //////////////////////////////////////////////
  protected _startSpan(name: string, options?: SpanOptions): Span {
    const tracerToUse = this.getTracer();
    const contextToUse = this._contextStorage?.getStore() || context.active();
    const span = tracerToUse
      ? tracerToUse.startSpan(name, options, contextToUse)
      : dummySpan(name, options, contextToUse);
    return span;
  }
  /**
   * Allow for future extensibility - track span starts internally.
   * @param id
   * @param span
   */
  protected _internalSpanStart(id: number, name: string, options?: SpanOptions): Span {
    const span = this._startSpan(name, options);
    this._activeSpans.set(id, span);
    return span;
  }

  protected _internalSpanGet(id: number): Span | undefined {
    return this._activeSpans.get(id);
  }
  /**
   * Allow for future extensibility - track span ends internally.
   * @param id
   */
  protected _internalSpanEnd(id: number, span: Span): void {
    if (this._activeSpans.delete(id)) {
      span.end();
    }
  }

  private _getBaseNativeInstrument(): NativeInstrument {
    return {
      name: this.instrumentationName,
      version: this.instrumentationVersion,
      type: this._nativeInstrumentDef?.type || "custom",
    };
  }

  private _markConfigDirty(dirty: boolean): void {
    // will trigger a shutdown/restart on the next tick.
    if (dirty && this._enabledCalled) {
      this._shutdownSequence();
      this._startupSequence();
    }
  }
  // protected by latch
  private _startupSequence(): void {
    this._instrumentId = Bun.telemetry.attach(this._customizeNativeInstrument(this._getBaseNativeInstrument()));
  }

  // protected by latch
  private _shutdownSequence(): void {
    if (this._instrumentId) {
      Bun.telemetry.detach(this._instrumentId);
      this._instrumentId = undefined;
    }

    // Clean up any remaining spans
    this._activeSpans.clear();
  }

  /**
   * Main entry point to customize the native instrument definition before attaching.
   * @param instrument
   * @param config
   * @param tracer
   * @returns
   */
  protected _customizeNativeInstrument(instrument: NativeInstrument): NativeInstrument {
    return instrument;
  }

  ///////////////////////////////////////////////////// OPERATION HANDLERS //////////////////////////////////////////////

  /**
   * Generate W3C trace context headers for a given operation.
   * Returns {traceparent, tracestate} object or undefined if span not found.
   */
  protected generateTraceHeaders(id: number): { traceparent: string; tracestate: string } | undefined {
    const span = this._activeSpans.get(id);
    if (!span) return undefined;

    const spanContext = span.spanContext();
    return {
      traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16).padStart(2, "0")}`,
      tracestate: spanContext.traceState?.serialize() || "",
    };
  }

  /**
   * Handle operation errors by recording exception, setting error status, and cleaning up.
   * Subclasses can override onErrorCleanup for additional cleanup logic.
   */
  protected handleOperationError(id: number, attributes: Record<string, any>, message = "Unknown error"): void {
    const span = this._activeSpans.get(id);
    if (!span) return;

    span.recordException({
      name: attributes[ATTR_ERROR_TYPE] || "Error",
      message: attributes[ATTR_ERROR_MESSAGE] || message,
      stack: attributes["error.stack_trace"], // non-standard attribute for stack trace
    });

    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: attributes[ATTR_ERROR_MESSAGE] || message,
    });

    this._internalSpanEnd(id, span);

    // Allow subclasses to do additional cleanup
    this.onErrorCleanup(id);
  }

  /**
   * Hook for subclasses to perform additional cleanup on error.
   * Override in subclasses if needed.
   */
  protected onErrorCleanup(id: number): void {
    // Override in subclasses if needed
  }

  /**
   * Record operation metrics using stored metric attributes.
   * Merges attributes from haystack based on needle keys, then records to histograms and counter.
   *
   * @param id Operation ID to retrieve stored metric attributes
   * @param durationNs Duration in nanoseconds
   * @param haystackAttrs Attributes to search for additional metric dimensions
   * @param needleAttrKeys Keys to extract from haystack and add to metrics
   */
  protected recordOperationMetrics(
    id: number,
    durationNs: number,
    haystackAttrs: Record<string, unknown>,
    needleAttrKeys: string[],
  ): void {
    if (!this._oldHttpServerDurationHistogram) return;

    const durationMs = durationNs / 1_000_000;
    const durationS = durationMs / 1000;

    // Retrieve metric attributes stored at operation start
    const metricAttributes = this._activeMetricAttributes.get(id);
    if (!metricAttributes) return;

    // Augment with needle attributes from haystack
    for (const key of needleAttrKeys) {
      if (haystackAttrs[key] !== undefined) {
        metricAttributes[key] = haystackAttrs[key];
      }
    }

    // Record to old histogram (milliseconds)
    this._oldHttpServerDurationHistogram.record(durationMs, metricAttributes);

    // Record to stable histogram (seconds)
    if (this._stableHttpServerDurationHistogram) {
      this._stableHttpServerDurationHistogram.record(durationS, metricAttributes);
    }

    // Increment request counter if available
    if (this._httpServerRequestsCounter) {
      this._httpServerRequestsCounter.add(1, metricAttributes);
    }
  }

  ////////////////////////////////////////////// UTILITIES //////////////////////////////////////////////

  protected maybeCopyAttributes(attributes: Record<string, any> | undefined, target: Span, ...keys: string[]): void {
    if (!attributes) return;
    for (const key of keys) {
      if (attributes[key] !== undefined) {
        target.setAttribute(key, attributes[key]);
      }
    }
  }

  protected setStatusCodeFromHttpStatus(
    attributes: Record<string, any>,
    span: Span,
    errorPredicate: (statusCode: number) => boolean,
  ): void {
    const statusCode = attributes["http.response.status_code"] as number | undefined;
    if (typeof statusCode === "number") {
      if (errorPredicate(statusCode)) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${statusCode}`,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
    }
  }
}

const noopContext: Context = {
  getValue: (_key: symbol) => undefined,
  setValue: (_key: symbol, _value: unknown) => noopContext,
  deleteValue: (_key: symbol) => noopContext,
};
/**
 * Just so we can tag stuff on it if needed
 * @returns
 */
function dummySpan(name: string, options: SpanOptions | undefined = {}, context: Context = noopContext): Span {
  const attributes: Record<string, any> = { ...options?.attributes };
  const data = {
    kind: options?.kind || SpanKind.INTERNAL,
    name,
    traceId: "00000000000000000000000000000000",
    spanId: "0000000000000000",
    traceFlags: 0,
  };
  const span = {
    name,
    attributes,
    context: () => context,
    spanContext: () => data,
    setAttribute: (k: string, v: any) => {
      attributes[k] = v;
      return span;
    },
    setAttributes: () => {
      Object.assign(span.attributes, attributes);
      return span;
    },
    addEvent: () => span,
    setStatus: () => span,
    updateName: () => span,
    end: () => {},
    isRecording: () => false,
    recordException: () => {},
    addLink: () => {
      return span;
    },
    addLinks() {
      return this;
    },
  };
  return span as unknown as Span;
}
