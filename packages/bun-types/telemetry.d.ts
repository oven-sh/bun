declare module "bun" {
  /**
   * Native OpenTelemetry tracing.
   *
   * Enable with `BUN_OTEL=1` (then the standard `OTEL_*` environment variables
   * apply), an `[otel]` table in `bunfig.toml`, or {@link otel.start}.
   * Once enabled, `Bun.serve`, `node:http`, `fetch`, `Bun.sql`, `bun:sqlite`,
   * `Bun.redis`, `Bun.connect`/`node:net`, `WebSocket`, `node:fs`,
   * `Bun.spawn` and `Bun.dns` emit spans, `traceparent` is propagated on
   * incoming and outgoing HTTP, and `@opentelemetry/api` (`trace`, `context`,
   * `propagation`) is backed by the same native pipeline.
   */
  namespace otel {
    /**
     * `SpanKind` numbering from `@opentelemetry/api`. The constants are
     * available at runtime as `Bun.otel.SpanKind.SERVER` etc.; APIs that take a
     * kind also accept the lowercase name (`"server"`).
     */
    type SpanKind = SpanKind.INTERNAL | SpanKind.SERVER | SpanKind.CLIENT | SpanKind.PRODUCER | SpanKind.CONSUMER;
    namespace SpanKind {
      type INTERNAL = 0;
      type SERVER = 1;
      type CLIENT = 2;
      type PRODUCER = 3;
      type CONSUMER = 4;
    }
    type SpanKindName = "internal" | "server" | "client" | "producer" | "consumer";

    /**
     * `SpanStatusCode` numbering from `@opentelemetry/api`. At runtime:
     * `Bun.otel.SpanStatusCode.ERROR` etc.; `setStatus` also accepts `"ok"` / `"error"`.
     */
    type SpanStatusCode = SpanStatusCode.UNSET | SpanStatusCode.OK | SpanStatusCode.ERROR;
    namespace SpanStatusCode {
      type UNSET = 0;
      type OK = 1;
      type ERROR = 2;
    }
    type SpanStatusName = "unset" | "ok" | "error";

    /**
     * Same shape as `@opentelemetry/api`'s `AttributeValue` (so `Bun.otel.Tracer`
     * is assignable to the api's `Tracer`), plus `bigint` and readonly arrays.
     */
    type AttributeValue =
      | string
      | number
      | boolean
      | bigint
      | Array<null | undefined | string>
      | Array<null | undefined | number>
      | Array<null | undefined | boolean>
      | ReadonlyArray<null | undefined | string>
      | ReadonlyArray<null | undefined | number>
      | ReadonlyArray<null | undefined | boolean>;
    interface Attributes {
      [attributeKey: string]: AttributeValue | undefined;
    }

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
      /** The W3C `tracestate` carried with this span, if any. */
      traceState?: TraceState;
    }

    /**
     * A `SpanContext` given *to* Bun (`SpanOptions.parent`, `Link.context`,
     * `Bun.otel.with`): `traceState` may also be the raw header string.
     */
    interface SpanContextInput extends Omit<SpanContext, "traceState"> {
      traceState?: TraceState | string;
    }

    /** Immutable view of a W3C `tracestate` header (`@opentelemetry/api` `TraceState`). */
    interface TraceState {
      get(key: string): string | undefined;
      /** Returns a new TraceState with `key` set (moved to the front). */
      set(key: string, value: string): TraceState;
      /** Returns a new TraceState without `key`. */
      unset(key: string): TraceState;
      /** The header value. */
      serialize(): string;
    }

    interface Link {
      context: SpanContext | SpanContextInput;
      attributes?: Attributes;
    }

    interface SpanOptions {
      /** @default "internal" */
      kind?: SpanKind | SpanKindName | undefined;
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
      parent?: Span | SpanContextInput | null | undefined;
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
      /** Shorthand for {@link setAttribute} / {@link setAttributes}. */
      set(key: string, value: AttributeValue): this;
      set(attributes: Attributes): this;
      /**
       * @param attributesOrStartTime attributes for the event, or its timestamp
       * @param startTime timestamp when the second argument is attributes
       */
      addEvent(name: string, attributesOrStartTime?: Attributes | TimeInput, startTime?: TimeInput): this;
      addLink(link: Link): this;
      addLinks(links: Link[]): this;
      /** `message` is only kept for `"error"`. */
      setStatus(status: { code: SpanStatusCode; message?: string }): this;
      setStatus(code: SpanStatusCode | SpanStatusName, message?: string): this;
      /**
       * Record `error` as an `exception` event and set the status to `"error"`
       * with its message. `Bun.otel.span(name, fn)` does this for you when
       * `fn` throws or rejects.
       */
      fail(error: unknown): this;
      /** Set the status to `"ok"` (final: a later error does not override it). */
      ok(): this;
      updateName(name: string): this;
      /** Adds an `exception` event with `exception.type` / `.message` / `.stacktrace`. */
      recordException(exception: unknown, time?: TimeInput): this;
      /**
       * Ends the span and queues it for export; if this span made itself the
       * active one (`Bun.otel.span(name)`, `startActiveSpan(name)`, `enter()`)
       * it also stops being active. Later calls are ignored.
       */
      end(endTime?: TimeInput): void;
      /**
       * Make this the active span until {@link Span.exit} (or disposal).
       * Prefer `tracer.startActiveSpan(name, fn)` (or, in synchronous code,
       * `using span = tracer.startActiveSpan(name)`), which pair these for
       * you; in an `async` function a bare `enter()` is seen by the caller
       * while the function is suspended, like `AsyncLocalStorage.enterWith`.
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
       * ends the span and restores the previously active one. Inside an
       * `async` function this has `AsyncLocalStorage.enterWith` semantics:
       * the activation happens in the caller's frame, so the caller sees the
       * span as active while the function is suspended at an `await`; prefer
       * the callback form there.
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
      type?: "otlp" | undefined;
      /**
       * OTLP/HTTP endpoint. A bare origin (`http://collector:4318`) gets
       * `/v1/traces` appended; a URL with a path is used as-is.
       */
      url: string;
      /** Extra request headers, e.g. `{ "x-api-key": "..." }`. */
      headers?: Record<string, string> | undefined;
      /** @default "none" */
      compression?: "gzip" | "none" | undefined;
      /** Total time one export request may take before it is aborted and retried. @default 10000 */
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
      links: {
        traceId: string;
        spanId: string;
        traceState?: string;
        /** OTLP link flags: low byte = W3C trace flags, 0x100 = is-remote known, 0x200 = is remote. */
        flags: number;
        attributes: ExportedSpan["attributes"];
      }[];
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
     * every span recorded since the previous call. It may return a promise:
     * the batch counts as exported when it resolves (a rejection or throw is
     * a failed export and a warning, and `forceFlush()` / exit wait for it).
     */
    type FunctionExporterOptions =
      | {
          /** Decoded spans. */
          export(spans: ExportedSpan[]): void | Promise<void>;
        }
      | {
          /** An encoded OTLP `ExportTraceServiceRequest` (protobuf). */
          exportProtobuf(request: Uint8Array<ArrayBuffer>): void | Promise<void>;
        }
      | {
          /** An OTLP/JSON `ExportTraceServiceRequest`. */
          exportJSON(request: string): void | Promise<void>;
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
      exporters?: Array<string | OtlpExporterOptions | FunctionExporterOptions> | undefined;
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
            /** Alias of `delayMs` (the SDK's name). */
            scheduledDelayMillis?: number | undefined;
            /** Alias of `timeoutMs` (the SDK's name). */
            exportTimeoutMillis?: number | undefined;
            /** Spans buffered before new ones are dropped. @default 2048 */
            maxQueueSize?: number | undefined;
            /** Buffered span count that triggers an immediate export. @default 512 */
            maxExportBatchSize?: number | undefined;
          }
        | undefined;
      /**
       * Record `db.query.text` on SQL, SQLite and Redis spans: the text handed
       * to the driver (parameterized for tagged templates; verbatim for
       * `sql.unsafe()`, `sql.file()`, `db.exec()`); Redis records the command
       * and first argument only, and nothing for `AUTH`/`HELLO`/`ACL`/`CONFIG`/
       * `MIGRATE`. Server error messages still reach the span's status and
       * exception event when this is off. Env: `BUN_OTEL_CAPTURE_DB_STATEMENT`.
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
      /** Spans delivered by at least one exporter. */
      spansExported: number;
      /** Spans no exporter delivered (queue overflow, no exporters, or every exporter gave up). */
      spansDropped: number;
      /** Export requests that succeeded, counted per exporter. */
      exportsSucceeded: number;
      /** Export requests that were given up on, counted per exporter. */
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
     * `OTEL_*` environment variables (`process.env` as it is at the call),
     * then to defaults — also on a repeat
     * call, which is a process-wide reconfiguration (from a worker too):
     * spans already recorded are flushed with the previous configuration,
     * and only the exporter list is kept when `exporters`/`endpoint` are
     * omitted. A no-op under `OTEL_SDK_DISABLED=true`.
     */
    start(options?: otel.StartOptions): void;

    /** Whether tracing is enabled in this process. */
    readonly enabled: boolean;

    /**
     * Run `fn` inside a new span, active for everything `fn` does (including
     * across `await`). The span ends when `fn` returns, or when the promise it
     * returns settles; if `fn` throws or rejects, the error is recorded on the
     * span ({@link otel.Span.fail}) and rethrown.
     *
     * ```ts
     * const user = await Bun.otel.span("loadUser", { "user.id": id }, async span => {
     *   const user = await db.users.find(id); // a child span
     *   span.set("cache.hit", false);
     *   return user;
     * });
     * ```
     *
     * Without `fn`, returns the span, active until it is disposed. In an
     * `async` function prefer the `fn` form: the activation below happens in
     * the caller's frame (`AsyncLocalStorage.enterWith` semantics), so the
     * caller sees the span while this function is suspended at an `await`.
     *
     * ```ts
     * {
     *   using span = Bun.otel.span("resize", { width, height });
     *   // ...
     * } // ends here
     * ```
     *
     * For other span options (kind, links, an explicit parent) use
     * {@link otel.Tracer.startActiveSpan}.
     */
    span<R>(name: string, fn: (span: otel.Span) => R): R;
    span<R>(name: string, attributes: otel.Attributes | undefined, fn: (span: otel.Span) => R): R;
    span(name: string, attributes?: otel.Attributes): otel.Span;

    /**
     * Wrap a function so that every call runs inside a span — like
     * {@link span}, but declared once, with `this` and the arguments passed
     * through and the span named after the function (or `name`; one of the
     * two is required, an anonymous function without `name` throws). The span
     * ends when the call returns or the promise it returns settles; a throw
     * or rejection is recorded on it. A non-`Promise` thenable result is
     * adopted with `Promise.resolve()` under the span and that `Promise` is
     * returned. The wrapped function is not a constructor; wrapping a class
     * throws. So does wrapping a generator function: the call returns its
     * iterator before the body runs, so trace the work inside it with
     * `Bun.otel.span` instead.
     *
     * ```ts
     * export const loadUser = Bun.otel.wrap(async function loadUser(id: string) {
     *   Bun.otel.set("user.id", id);
     *   return await db.users.find(id);
     * });
     * ```
     */
    wrap<F extends (...args: any[]) => any>(fn: F): F;
    wrap<F extends (...args: any[]) => any>(name: string, fn: F): F;

    /**
     * Set attributes on the active span (the current request's, a
     * `wrap()`ed call's, …). Returns `false` when no span is active.
     *
     * ```ts
     * Bun.serve({
     *   fetch(req) {
     *     Bun.otel.set("user.id", auth(req).id);
     *     // ...
     *   },
     * });
     * ```
     */
    set(key: string, value: otel.AttributeValue): boolean;
    set(attributes: otel.Attributes): boolean;

    /**
     * Get the tracer for an instrumentation scope (a library name and
     * version). Tracers are cached by `name@version`; `Bun.otel.span()` uses
     * the default one.
     */
    tracer(name?: string, version?: string): otel.Tracer;

    /** The active span, if any. Inside a `Bun.serve` handler this is the request's span. */
    activeSpan(): otel.Span | undefined;

    /** Run `fn` with `span` (or an `@opentelemetry/api` `Context`) active. */
    with<R, A extends unknown[]>(
      span: otel.Span | otel.SpanContextInput | otel.Context | undefined,
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
     * `@opentelemetry/api`-compatible `TracerProvider` (with `forceFlush()`
     * and `shutdown()`). Bun registers it as the API's global provider when
     * tracing is enabled, unless something else registered first.
     */
    readonly tracerProvider: {
      getTracer(name?: string, version?: string): otel.Tracer;
      forceFlush(): Promise<void>;
      shutdown(): Promise<void>;
    };
    /** `@opentelemetry/api`-compatible `ContextManager`. */
    readonly contextManager: {
      active(): otel.Context;
      with<R, A extends unknown[]>(context: otel.Context, fn: (...args: A) => R, thisArg?: unknown, ...args: A): R;
      /**
       * A function runs in `context` on every call; an `EventEmitter` has its
       * `emit()` wrapped, so every listener (including ones added before
       * `bind`) runs in `context` — the SDK's manager patches listener
       * registration instead and only affects listeners added afterwards.
       */
      bind<T>(context: otel.Context, target: T): T;
      enable(): typeof Bun.otel.contextManager;
      disable(): typeof Bun.otel.contextManager;
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
