/**
 * Implementation of OtelCapabilities
 *
 * This is the ONLY file that imports from @opentelemetry/*
 * Everything else uses the clean OtelCapabilities interface
 */

import {
  context,
  Counter,
  Histogram,
  Meter,
  MeterProvider,
  propagation,
  Span,
  SpanKind,
  SpanStatusCode,
  trace,
  Tracer,
  TracerProvider,
  ValueType,
} from "@opentelemetry/api";

import type { CapabilitiesConfig, OtelCapabilities } from "../capabilities";

/**
 * Simple header getter for W3C trace context propagation
 */
const HEADER_GETTER = {
  get(carrier: Record<string, string>, key: string): string | undefined {
    return carrier[key.toLowerCase()];
  },
  keys(carrier: Record<string, string>): string[] {
    return Object.keys(carrier);
  },
};

/**
 * Unified state for an operation
 */
interface OperationState {
  /** Active span for tracing */
  span?: Span;
  /** Start time for duration calculation (when nativeDuration is undefined) */
  startTime?: bigint;
  /** Cached metric attributes from start event */
  metricAttributes?: Record<string, any>;
}

/**
 * Helper: Copy attributes from source to destination span
 * Avoids creating intermediate objects
 */
function copyAttributesToSpan(source: Record<string, any>, span: Span, keys: string[]): void {
  for (const key of keys) {
    const val = source[key];
    if (val !== undefined) {
      span.setAttribute(key, val);
    }
  }
}

/**
 * Helper: Copy attributes from source to destination map
 * Avoids creating intermediate objects
 */
function copyAttributesToMap(source: Record<string, any>, dest: Record<string, any>, keys: string[]): void {
  for (const key of keys) {
    const val = source[key];
    if (val !== undefined) {
      dest[key] = val;
    }
  }
}

/**
 * Internal implementation of OtelCapabilities
 *
 * Handles:
 * - Span lifecycle (create, update, end, error)
 * - Parent context extraction from headers
 * - AsyncLocalStorage context updates
 * - Metrics recording (histogram + counter)
 * - Duration tracking (native or internal)
 */
export class OtelCapabilitiesImpl implements OtelCapabilities {
  readonly tracingEnabled: boolean;
  readonly metricsEnabled: boolean;

  private readonly _name: string;
  private readonly _version: string;
  private readonly _config: CapabilitiesConfig;

  // OTel providers
  private _tracer?: Tracer;
  private _meter?: Meter;

  // Unified operation state
  private readonly _operations = new Map<number, OperationState>();

  // Metrics instruments
  private _histogram?: Histogram;
  private _counter?: Counter;

  constructor(
    name: string,
    version: string,
    config: CapabilitiesConfig,
    providers: {
      tracerProvider?: TracerProvider;
      meterProvider?: MeterProvider;
    },
  ) {
    this._name = name;
    this._version = version;
    this._config = config;

    // Determine what's enabled based on config + providers
    this.tracingEnabled = !!(providers.tracerProvider && config.trace);
    this.metricsEnabled = !!(providers.meterProvider && config.metrics);

    // Setup tracing
    if (this.tracingEnabled) {
      this._tracer = providers.tracerProvider!.getTracer(name, version);
    }

    // Setup metrics
    if (this.metricsEnabled) {
      this._meter = providers.meterProvider!.getMeter(name, version);

      // Create histogram for duration if configured
      const histogramConfig = config.metricInstruments?.histogram;
      if (histogramConfig) {
        this._histogram = this._meter.createHistogram(histogramConfig.name, {
          description: histogramConfig.description,
          unit: histogramConfig.unit || "s",
          valueType: ValueType.DOUBLE,
          advice: histogramConfig.buckets ? { explicitBucketBoundaries: histogramConfig.buckets } : undefined,
        });
      }

      // Create counter if configured
      const counterConfig = config.metricInstruments?.counter;
      if (counterConfig) {
        this._counter = this._meter.createCounter(counterConfig.name, {
          description: counterConfig.description,
          unit: counterConfig.unit,
        });
      }
    }
  }

  startSpan(id: number, attributes: Record<string, any>): void {
    // Initialize operation state
    const state: OperationState = {};

    // Handle tracing
    if (this.tracingEnabled) {
      // Extract parent context if configured
      let parentContext = context.active();
      if (this._config.extractParentContext) {
        const headers = this._config.extractParentContext(attributes);
        if (headers?.traceparent) {
          parentContext = propagation.extract(parentContext, headers, HEADER_GETTER);
        }
      }

      // Determine span name
      const spanName = this._config.extractSpanName
        ? this._config.extractSpanName(attributes)
        : `${this._name} operation`;

      // Determine span kind (cast to SpanKind for type safety at implementation boundary)
      const spanKind = (
        this._config.extractSpanKind ? this._config.extractSpanKind(attributes) : SpanKind.INTERNAL
      ) as SpanKind;

      // Create span
      const span = this._tracer!.startSpan(
        spanName,
        {
          kind: spanKind,
        },
        parentContext,
      );

      // Copy attributes directly to span (no intermediate object)
      const startKeys = this._config.trace?.start;
      if (startKeys && startKeys.length > 0) {
        copyAttributesToSpan(attributes, span, startKeys);
      }

      state.span = span;

      // Update async context if configured (SERVER spans)
      // This makes the span available via context.active() for downstream calls (e.g., fetch)
      if (this._config.setsAsyncStorageContext && this._config.contextManager) {
        const contextManager = this._config.contextManager;
        // Check if context manager supports enterWith (like BunAsyncLocalStorageContextManager)
        if (typeof contextManager.enterWith === "function") {
          const spanContext = trace.setSpan(parentContext, span);
          contextManager.enterWith(spanContext);
        }
      }
    }

    // Track start time if we need to calculate duration internally
    if (this._config.nativeDuration === undefined) {
      state.startTime = process.hrtime.bigint();
    }

    // Cache metric attributes from start event for later
    const metricStartKeys = this._config.metrics?.start;
    if (this.metricsEnabled && metricStartKeys && metricStartKeys.length > 0) {
      state.metricAttributes = {};
      copyAttributesToMap(attributes, state.metricAttributes, metricStartKeys);
    }

    // Store unified state
    this._operations.set(id, state);
  }

  updateSpan(id: number, attributes: Record<string, any>): void {
    if (!this.tracingEnabled) return;

    const state = this._operations.get(id);
    if (!state?.span) return;

    const updateKeys = this._config.trace?.update;
    if (updateKeys && updateKeys.length > 0) {
      copyAttributesToSpan(attributes, state.span, updateKeys);
    }
  }

  endSpan(id: number, attributes: Record<string, any>): void {
    const state = this._operations.get(id);
    if (!state) return;

    // Handle tracing
    if (this.tracingEnabled && state.span) {
      const endKeys = this._config.trace?.end;
      if (endKeys && endKeys.length > 0) {
        copyAttributesToSpan(attributes, state.span, endKeys);
      }

      // Determine if error based on config
      const isError = this._config.isError ? this._config.isError(attributes) : false;

      if (isError) {
        state.span.setStatus({ code: SpanStatusCode.ERROR });
      } else {
        state.span.setStatus({ code: SpanStatusCode.OK });
      }

      state.span.end();
    }

    // Handle metrics
    if (this.metricsEnabled) {
      // Merge end attributes into cached metric attributes
      const metricEndKeys = this._config.metrics?.end;
      if (metricEndKeys && metricEndKeys.length > 0) {
        if (!state.metricAttributes) {
          state.metricAttributes = {};
        }
        copyAttributesToMap(attributes, state.metricAttributes, metricEndKeys);
      }

      this._recordMetrics(state, attributes);
    }

    // Single cleanup!
    this._operations.delete(id);
  }

  errorSpan(id: number, attributes: Record<string, any>): void {
    if (!this.tracingEnabled) return;

    const state = this._operations.get(id);
    if (!state?.span) return;

    // Record exception
    state.span.recordException({
      name: attributes["error.type"] || "Error",
      message: attributes["error.message"] || "Unknown error",
    });

    // Set error status
    state.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: attributes["error.message"],
    });

    const errKeys = this._config.trace?.err;
    if (errKeys && errKeys.length > 0) {
      copyAttributesToSpan(attributes, state.span, errKeys);
    }

    state.span.end();

    // Single cleanup!
    this._operations.delete(id);

    // TODO: Should we record error metrics?
    // For now, errors don't record duration metrics
  }

  getTraceInfo(id: number): { traceparent: string; tracestate: string } | undefined {
    if (!this.tracingEnabled) return undefined;

    const state = this._operations.get(id);
    if (!state?.span) return undefined;

    const ctx = state.span.spanContext();
    return {
      traceparent: `00-${ctx.traceId}-${ctx.spanId}-${ctx.traceFlags.toString(16).padStart(2, "0")}`,
      tracestate: ctx.traceState?.serialize() || "",
    };
  }

  /**
   * Record metrics for an operation
   */
  private _recordMetrics(state: OperationState, attributes: Record<string, any>): void {
    if (!this.metricsEnabled) return;

    // Use merged metric attributes from state
    const metricAttrs = state.metricAttributes || {};

    // Calculate duration
    let durationNs: number | undefined;

    if (this._config.nativeDuration === "end") {
      // Native provides duration in attributes
      durationNs = attributes["operation.duration"];
    } else if (this._config.nativeDuration === undefined && state.startTime) {
      // Calculate internally
      durationNs = Number(process.hrtime.bigint() - state.startTime);
    }

    if (durationNs !== undefined) {
      // Convert to seconds (OTel stable convention)
      const durationS = durationNs / 1_000_000_000;

      this._histogram?.record(durationS, metricAttrs);
    }

    // Always increment counter
    this._counter?.add(1, metricAttrs);
  }
}
