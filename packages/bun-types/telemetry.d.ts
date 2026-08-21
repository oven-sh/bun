declare module "bun" {
  /**
   * Native OpenTelemetry tracing.
   *
   * Enable with `BUN_OTEL=1` (then the standard `OTEL_*` environment variables
   * apply), a `[telemetry]` table in `bunfig.toml`, or {@link otel.start}.
   * Once enabled, `Bun.serve`, `node:http`, `fetch`, `Bun.sql`, `bun:sqlite`,
   * `Bun.redis`, `Bun.connect`/`node:net`, `WebSocket`, `node:fs`,
   * `Bun.spawn` and `Bun.dns` emit spans, `traceparent` is propagated on
   * incoming and outgoing HTTP, and `@opentelemetry/api` (`trace`, `context`,
   * `propagation`) is backed by the same native pipeline.
   */
  namespace otel {
    /**
     * `SpanKind` numbering from `@opentelemetry/api`.
     */
    type SpanKind = 0 | 1 | 2 | 3 | 4;

    /**
     * `SpanStatusCode` numbering from `@opentelemetry/api`.
     */
    type SpanStatusCode = 0 | 1 | 2;

    type AttributeValue = string | number | boolean | bigint | ReadonlyArray<string | number | boolean>;
    type Attributes = Record<string, AttributeValue | undefined | null>;

    /**
     * Anything the API accepts as a timestamp: epoch milliseconds, a `Date`,
     * or an `@opentelemetry/api` `HrTime` tuple (`[seconds, nanoseconds]`).
     */
    type TimeInput = number | Date | readonly [number, number];

    interface SpanContext {
      /** 32 lowercase hex characters. */
      traceId: string;
      /** 16 lowercase hex characters. */
      spanId: string;
      /** W3C trace flags; bit 0 = sampled. */
      traceFlags: number;
      /** Present and `true` when the context arrived via a `traceparent` header. */
      isRemote?: boolean;
      /**
       * The `tracestate` header to forward, if any. This is the raw header
       * string, not an `@opentelemetry/api` `TraceState` object.
       */
      traceState?: string;
    }

    interface Link {
      context: SpanContext;
      attributes?: Attributes;
    }

    interface SpanOptions {
      /** @default SpanKind.INTERNAL */
      kind?: SpanKind | undefined;
      attributes?: Attributes | undefined;
      links?: Link[] | undefined;
      /** Defaults to now. */
      startTime?: TimeInput | undefined;
      /** Ignore the active span and start a new trace. */
      root?: boolean | undefined;
      /**
       * Explicit parent. `undefined` (the default) uses the active span;
       * `null` starts a new trace.
       */
      parent?: Span | SpanContext | null | undefined;
    }

    /**
     * A span. Implements the `@opentelemetry/api` `Span` interface, so it can
     * be passed to any code written against that API.
     *
     * All mutators are no-ops after {@link Span.end} and on non-recording
     * (unsampled) spans, and return `this`.
     */
    interface Span extends Disposable {
      readonly traceId: string;
      readonly spanId: string;
      /** `undefined` for root spans. */
      readonly parentSpanId: string | undefined;
      readonly traceFlags: number;
      readonly isRemote: boolean;
      readonly name: string;
      readonly kind: SpanKind;
      readonly ended: boolean;

      spanContext(): SpanContext;
      isRecording(): boolean;
      setAttribute(key: string, value: AttributeValue): this;
      setAttributes(attributes: Attributes): this;
      /**
       * @param attributesOrStartTime attributes for the event, or its timestamp
       * @param startTime timestamp when the second argument is attributes
       */
      addEvent(name: string, attributesOrStartTime?: Attributes | TimeInput, startTime?: TimeInput): this;
      addLink(link: Link): this;
      addLinks(links: Link[]): this;
      /** `message` is only kept for `SpanStatusCode.ERROR`. */
      setStatus(status: { code: SpanStatusCode; message?: string }): this;
      setStatus(code: SpanStatusCode, message?: string): this;
      updateName(name: string): this;
      /** Adds an `exception` event with `exception.type` / `.message` / `.stacktrace`. */
      recordException(exception: unknown, time?: TimeInput): this;
      /** Ends the span and queues it for export. Later calls are ignored. */
      end(endTime?: TimeInput): void;
      /**
       * Make this the active span until {@link Span.exit} (or disposal).
       * Prefer `tracer.startActiveSpan(name, fn)` or
       * `using span = tracer.startActiveSpan(name)`, which pair these for you.
       */
      enter(): this;
      /** Undo {@link Span.enter}, restoring whatever was active before it. */
      exit(): this;
      /** Ends the span and, if it was entered, exits it. */
      [Symbol.dispose](): void;
    }

    /**
     * Creates spans for one instrumentation scope. Implements the
     * `@opentelemetry/api` `Tracer` interface.
     */
    interface Tracer {
      readonly name: string;
      readonly version: string | undefined;

      /** Start a span without activating it. */
      startSpan(name: string, options?: SpanOptions, context?: Context): Span;

      /**
       * Start a span and make it the active span. With a callback, the span
       * is active while `fn` runs (including across `await` inside it) and
       * `fn`'s return value is returned; you end the span yourself, as in
       * `@opentelemetry/api`.
       *
       * Without a callback the span is returned already active, for
       * `using span = tracer.startActiveSpan("name")` — leaving the block
       * ends the span and restores the previously active one.
       */
      startActiveSpan<R>(name: string, fn: (span: Span) => R): R;
      startActiveSpan<R>(name: string, options: SpanOptions, fn: (span: Span) => R): R;
      startActiveSpan<R>(name: string, options: SpanOptions, context: Context, fn: (span: Span) => R): R;
      startActiveSpan(name: string, options?: SpanOptions, context?: Context): Span;
    }

    /**
     * An immutable `@opentelemetry/api` `Context`: the active span plus any
     * values stored under other context keys (baggage).
     */
    interface Context {
      getValue(key: symbol): unknown;
      setValue(key: symbol, value: unknown): Context;
      deleteValue(key: symbol): Context;
    }

    interface OtlpExporterOptions {
      /**
       * OTLP/HTTP endpoint. A bare origin (`http://collector:4318`) gets
       * `/v1/traces` appended; a URL with a path is used as-is.
       */
      url: string;
      /** Extra request headers, e.g. `{ "x-api-key": "..." }`. */
      headers?: Record<string, string> | undefined;
      /** @default "none" */
      compression?: "gzip" | "none" | undefined;
      /** Per-request timeout. @default 10000 */
      timeoutMs?: number | undefined;
    }

    /**
     * A hosted backend that takes OTLP/HTTP with a static credential. The
     * endpoint and auth header are derived from `type`; every field falls
     * back to the vendor's usual environment variable.
     *
     * | `type`      | credential (`apiKey`)                         | `site` / `id`                                        |
     * | ----------- | --------------------------------------------- | ---------------------------------------------------- |
     * | `datadog`   | `DD_API_KEY` (omit to use a local Agent on :4318) | `site`: `DD_SITE` (`datadoghq.com`, `datadoghq.eu`, …) |
     * | `honeycomb` | `HONEYCOMB_API_KEY`                           | `site`: `"us"` \| `"eu"`; `id`: classic dataset       |
     * | `grafana`   | Cloud Access Policy token                      | `site`: OTLP gateway zone (`prod-us-east-0`); `id`: instance id |
     * | `newrelic`  | `NEW_RELIC_LICENSE_KEY`                       | `site`: `"us"` \| `"eu"` \| `"fedramp"`               |
     * | `axiom`     | `AXIOM_TOKEN`                                 | `id`: `AXIOM_DATASET`; `site`: edge domain             |
     * | `dynatrace` | `DT_API_TOKEN`                                | `id`: environment id, or `endpoint`: `…/api/v2/otlp`   |
     * | `sentry`    | DSN public key (`SENTRY_PUBLIC_KEY`)          | `endpoint` (or `SENTRY_OTLP_TRACES_ENDPOINT`): the project's OTLP traces URL |
     * | `otlp`      | —                                             | `endpoint` (default `http://localhost:4318`)           |
     */
    interface PresetExporterOptions {
      type: "datadog" | "honeycomb" | "grafana" | "newrelic" | "axiom" | "dynatrace" | "sentry" | "otlp";
      apiKey?: string | undefined;
      /** Vendor region / site / zone. */
      site?: string | undefined;
      /** Second identifier where the vendor needs one (dataset, instance id, environment id). */
      id?: string | undefined;
      /** Override the derived endpoint (base URL; `/v1/traces` is appended). */
      endpoint?: string | undefined;
      /** Extra request headers merged over the preset's. */
      headers?: Record<string, string> | undefined;
      /** @default "gzip" */
      compression?: "gzip" | "none" | undefined;
      timeoutMs?: number | undefined;
    }

    /**
     * A decoded span as handed to a function exporter (and returned by
     * {@link otel.decode}). Times are Unix epoch milliseconds with
     * sub-millisecond precision.
     */
    interface ExportedSpan {
      traceId: string;
      spanId: string;
      parentSpanId: string | undefined;
      name: string;
      kind: SpanKind;
      startTime: number;
      endTime: number;
      attributes: Record<string, string | number | boolean | Array<string | number | boolean>>;
      events: { name: string; time: number; attributes: ExportedSpan["attributes"] }[];
      links: { traceId: string; spanId: string; traceState?: string; attributes: ExportedSpan["attributes"] }[];
      status: { code: SpanStatusCode; message?: string };
      traceFlags: number;
      traceState?: string;
      droppedAttributesCount?: number;
      droppedEventsCount?: number;
      droppedLinksCount?: number;
      /** Shared between all spans of the same scope in a batch. */
      scope: { name: string; version?: string };
      /** Shared between all spans in a batch. */
      resource: { attributes: ExportedSpan["attributes"] };
    }

    /**
     * A function exporter. Give exactly one of the three callbacks; it is
     * called on the batch interval (and on `forceFlush()` / at exit) with
     * every span recorded since the previous call.
     */
    type FunctionExporterOptions =
      | {
          /** Decoded spans. */
          export(spans: ExportedSpan[]): void;
        }
      | {
          /** An encoded OTLP `ExportTraceServiceRequest` (protobuf). */
          exportProtobuf(request: Uint8Array<ArrayBuffer>): void;
        }
      | {
          /** An OTLP/JSON `ExportTraceServiceRequest`. */
          exportJSON(request: string): void;
        };

    /**
     * Built-in instrumentation names, as used by
     * {@link StartOptions.instrumentations} and `BUN_OTEL_INSTRUMENTATIONS`.
     */
    type Instrumentation = "http" | "fetch" | "sql" | "sqlite" | "redis" | "net" | "websocket" | "fs" | "spawn" | "dns";

    interface StartOptions {
      /** `service.name` resource attribute. Overrides `OTEL_SERVICE_NAME`. */
      serviceName?: string | undefined;
      /** Extra resource attributes. Merged over `OTEL_RESOURCE_ATTRIBUTES`. */
      resourceAttributes?: Record<string, string | number | boolean> | undefined;
      /**
       * Shorthand for a single OTLP/HTTP exporter. Same rules as
       * {@link OtlpExporterOptions.url}.
       */
      endpoint?: string | undefined;
      /** Headers for {@link StartOptions.endpoint}. */
      headers?: Record<string, string> | undefined;
      /**
       * Where spans go. Each entry is an OTLP/HTTP endpoint (URL string or
       * options object), a function exporter, or `"console"`. Every exporter
       * receives every batch. When given, replaces exporters configured by
       * the environment or an earlier `start()` call; when omitted,
       * `OTEL_EXPORTER_OTLP_*` / `OTEL_TRACES_EXPORTER` decide.
       */
      exporters?: Array<string | OtlpExporterOptions | PresetExporterOptions | FunctionExporterOptions> | undefined;
      /**
       * Sampler. A number is a parent-based trace-id ratio (`0.1` keeps 10%
       * of new traces and follows the caller's decision for propagated ones).
       * @default "parentbased_always_on"
       */
      sampler?:
        | number
        | "always_on"
        | "always_off"
        | "traceidratio"
        | "parentbased_always_on"
        | "parentbased_always_off"
        | "parentbased_traceidratio"
        | undefined;
      /** Ratio for the `*traceidratio` samplers. */
      samplerArg?: number | undefined;
      /**
       * Which built-in instrumentations record spans. An array is an
       * allow-list. In the object form, `false` disables one, `true` enables
       * it with its default root policy, `"always"` also lets it start new
       * traces, and `"nested"` records only under an already-active span.
       * By default all are enabled; `fs`, `sqlite`, `net`, `dns` and `spawn`
       * default to `"nested"` so a plain script does not emit a trace per
       * file read.
       */
      instrumentations?: Instrumentation[] | { [K in Instrumentation]?: boolean | "always" | "nested" } | undefined;
      /** Batch span processor tuning (`OTEL_BSP_*`). */
      batch?:
        | {
            /** How often buffered spans are exported. @default 5000 */
            delayMs?: number | undefined;
            /** How long the exit-time flush may block. @default 30000 */
            timeoutMs?: number | undefined;
            /** Spans buffered before new ones are dropped. @default 2048 */
            maxQueueSize?: number | undefined;
            /** Buffered span count that triggers an immediate export. @default 512 */
            maxExportBatchSize?: number | undefined;
          }
        | undefined;
      /**
       * Record `db.query.text` on SQL, SQLite and Redis spans. SQL text is the
       * parameterized statement; Redis records the command and first argument
       * only, and nothing for `AUTH`/`HELLO`/`ACL`/`CONFIG`/`MIGRATE`.
       * @default true
       */
      captureDbStatement?: boolean | undefined;
      /** @default ["tracecontext", "baggage"] */
      propagators?: Array<"tracecontext" | "baggage"> | undefined;
      /** Span limits (`OTEL_SPAN_*_LIMIT`). */
      limits?:
        | {
            /** @default 128 */
            attributeCountLimit?: number | undefined;
            /** @default 128 */
            eventCountLimit?: number | undefined;
            /** @default 128 */
            linkCountLimit?: number | undefined;
            /** Longer string attribute values are truncated. @default unlimited */
            attributeValueLengthLimit?: number | undefined;
          }
        | undefined;
    }

    interface Stats {
      spansExported: number;
      spansDropped: number;
      exportsSucceeded: number;
      exportsFailed: number;
      spansPending: number;
      exportsInflight: number;
    }

    interface TextMapSetter {
      set(carrier: unknown, key: string, value: string): void;
    }
    interface TextMapGetter {
      get(carrier: unknown, key: string): string | string[] | undefined;
      keys(carrier: unknown): string[];
    }
  }

  /**
   * Native OpenTelemetry tracing. See {@link otel.start}.
   */
  const otel: {
    /**
     * Enable tracing (or reconfigure it). Options not given fall back to the
     * `OTEL_*` environment variables, then to defaults.
     */
    start(options?: otel.StartOptions): void;

    /** Whether tracing is enabled in this process. */
    readonly enabled: boolean;

    /**
     * Get the tracer for an instrumentation scope. Tracers are cached by
     * `name@version`.
     */
    tracer(name?: string, version?: string): otel.Tracer;

    /** The active span, if any. Inside a `Bun.serve` handler this is the request's span. */
    activeSpan(): otel.Span | undefined;

    /** Run `fn` with `span` (or an `@opentelemetry/api` `Context`) active. */
    with<R, A extends unknown[]>(
      span: otel.Span | otel.SpanContext | otel.Context | undefined,
      fn: (...args: A) => R,
      thisArg?: unknown,
      ...args: A
    ): R;

    /**
     * Export everything buffered so far. Resolves once every exporter has
     * been handed the batch (function exporters have been called; HTTP
     * exporters have a response or have given up).
     */
    forceFlush(): Promise<void>;

    /** {@link forceFlush}, then disable all instrumentation. */
    shutdown(): Promise<void>;

    stats(): otel.Stats;

    /** Decode an OTLP protobuf `ExportTraceServiceRequest`. */
    decode(request: Uint8Array | ArrayBuffer): otel.ExportedSpan[];

    /** `SpanKind` numbering from `@opentelemetry/api`. */
    readonly SpanKind: {
      readonly INTERNAL: 0;
      readonly SERVER: 1;
      readonly CLIENT: 2;
      readonly PRODUCER: 3;
      readonly CONSUMER: 4;
    };
    /** `SpanStatusCode` numbering from `@opentelemetry/api`. */
    readonly SpanStatusCode: {
      readonly UNSET: 0;
      readonly OK: 1;
      readonly ERROR: 2;
    };

    /**
     * `@opentelemetry/api`-compatible `TracerProvider`. Bun registers it as
     * the API's global provider when tracing is enabled; pass it to
     * `trace.setGlobalTracerProvider()` yourself only if you have disabled
     * that.
     */
    readonly tracerProvider: { getTracer(name?: string, version?: string): otel.Tracer };
    /** `@opentelemetry/api`-compatible `ContextManager`. */
    readonly contextManager: {
      active(): otel.Context;
      with<R, A extends unknown[]>(context: otel.Context, fn: (...args: A) => R, thisArg?: unknown, ...args: A): R;
      bind<T>(context: otel.Context, target: T): T;
      enable(): unknown;
      disable(): unknown;
    };
    /** W3C `traceparent`/`tracestate`/`baggage` `TextMapPropagator`. */
    readonly propagator: {
      inject(context: otel.Context | undefined, carrier: unknown, setter?: otel.TextMapSetter): void;
      extract(context: otel.Context | undefined, carrier: unknown, getter?: otel.TextMapGetter): otel.Context;
      fields(): string[];
    };
    /** The empty {@link otel.Context}. */
    readonly ROOT_CONTEXT: otel.Context;
  };
}
