// Bun.otel — native OpenTelemetry tracing.
//
// Native side: src/runtime/telemetry.rs (host functions below), the span /
// tracer cells (JSTelemetrySpan.cpp, JSTelemetryTracer.cpp) and the
// active-span slot (TelemetryContext.cpp). This module is the JS surface: `Bun.otel`
// itself plus objects that satisfy the @opentelemetry/api TracerProvider /
// ContextManager / TextMapPropagator interfaces so `trace.getTracer()` etc.
// resolve to the native pipeline with no SDK installed.

const nativeStart = $newRustFunction("telemetry.rs", "start", 1);
const nativeIsEnabled = $newRustFunction("telemetry.rs", "isEnabled", 0);
const createScope = $newRustFunction("telemetry.rs", "createScope", 2);
const nativeActiveSpan = $newRustFunction("telemetry.rs", "activeSpan", 0);
const wrapSpanContext = $newCppFunction("JSTelemetryTracer.cpp", "jsTelemetryWrapSpanContext", 5);
const parseTraceparent = $newCppFunction("JSTelemetryTracer.cpp", "jsTelemetryParseTraceparent", 2);
const withContext = $newRustFunction("telemetry.rs", "withContext", 3);
const nativeForceFlush = $newRustFunction("telemetry.rs", "forceFlush", 0);
const nativeStats = $newRustFunction("telemetry.rs", "stats", 0);
const nativeExportSettled = $newRustFunction("telemetry.rs", "exportSettled", 3);
const nativeDecode = $newRustFunction("telemetry.rs", "decode", 1);
const nativeSetEnabled = $newRustFunction("telemetry.rs", "setEnabled", 2);
const nativePropagationFlags = $newRustFunction("telemetry.rs", "propagationFlags", 0);
const nativeInstrumentId = $newRustFunction("telemetry.rs", "instrumentId", 1);
const startInstrumentSpan = $newCppFunction("JSTelemetryTracer.cpp", "jsTelemetryStartInstrumentSpan", 4);
const propagationHeaders = $newCppFunction("JSTelemetryTracer.cpp", "jsTelemetryPropagationHeaders", 2);
const enterContext = $newCppFunction("TelemetryContext.cpp", "jsTelemetryEnterContext", 2);
const exitContext = $newCppFunction("TelemetryContext.cpp", "jsTelemetryExitContext", 1);
const activeExtras = $newCppFunction("TelemetryContext.cpp", "jsTelemetryActiveExtras", 0);

const ObjectDefineProperty = Object.defineProperty;
const ObjectKeys = Object.keys;
const ArrayFrom = Array.from;
const encodeURIComponent_ = encodeURIComponent;
const decodeURIComponent_ = decodeURIComponent;
const StringPrototypeSplit = String.prototype.split;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeTrim = String.prototype.trim;
const ArrayPrototypeJoin = Array.prototype.join;
const SafeMap = Map;

// @opentelemetry/api well-known keys (createContextKey === Symbol.for).
const SPAN_KEY = Symbol.for("OpenTelemetry Context Key SPAN");
const BAGGAGE_KEY = Symbol.for("OpenTelemetry Baggage Key");
const API_KEY = Symbol.for("opentelemetry.js.api.1");

const SpanKind = { INTERNAL: 0, SERVER: 1, CLIENT: 2, PRODUCER: 3, CONSUMER: 4 } as const;
const SpanStatusCode = { UNSET: 0, OK: 1, ERROR: 2 } as const;

/** W3C header form of an api `TraceState` (object with serialize()) or string. */
function traceStateHeader(traceState: any): string | undefined {
  if (traceState == null) return undefined;
  if (typeof traceState === "string") return traceState;
  if (typeof traceState.serialize === "function") return traceState.serialize() + "";
  return undefined;
}

/** A non-recording TelemetrySpan carrying `sc` (an api SpanContext-like object). */
function wrap(sc: any) {
  return wrapSpanContext(sc.traceId, sc.spanId, sc.traceFlags, sc.isRemote, traceStateHeader(sc.traceState));
}

/** Coerce anything span-like (ours, a foreign api Span, or a bare SpanContext) to a TelemetrySpan. */
function toNativeSpan(span: any) {
  if (span == null) return undefined;
  if ($isEmbedderInternalFieldObject(span)) return span;
  if (typeof span.spanContext === "function") {
    const sc = span.spanContext();
    return sc == null ? undefined : wrap(sc);
  }
  if (typeof span.traceId === "string") return wrap(span);
  return undefined;
}

// ── @opentelemetry/api Context ────────────────────────────────────────────
//
// A Context is an immutable (span, extras) pair. The active one is derived
// from the async-context slot on demand; `with()` installs one via the native
// helper which preserves any AsyncLocalStorage stores already in the slot.

class BunContext {
  #span: any;
  #extras: Map<symbol, unknown> | undefined;

  constructor(span?: any, extras?: Map<symbol, unknown> | null) {
    this.#span = span;
    this.#extras = extras ?? undefined;
  }

  getValue(key: symbol): unknown {
    if (key === SPAN_KEY) return this.#span;
    const extras = this.#extras;
    // (a null BAGGAGE_KEY entry means "deleted": the request's inbound baggage is masked)
    if (extras !== undefined && extras.$has(key)) return extras.$get(key) ?? undefined;
    // Baggage a request carried in lives on its span, not in extras.
    if (key === BAGGAGE_KEY && this.#span !== undefined) return parseBaggage(propagationHeaders(this.#span)[2]);
    return undefined;
  }

  setValue(key: symbol, value: unknown): BunContext {
    if (key === SPAN_KEY) return new BunContext(toNativeSpan(value), this.#extras);
    const m = new SafeMap(this.#extras);
    m.$set(key, value);
    return new BunContext(this.#span, m);
  }

  deleteValue(key: symbol): BunContext {
    if (key === SPAN_KEY) return new BunContext(undefined, this.#extras);
    if (key === BAGGAGE_KEY && this.#span !== undefined) {
      // propagation.deleteBaggage(ctx) must also mask what the request carried
      // in, so record the deletion rather than just dropping the entry.
      const m = new SafeMap(this.#extras);
      m.$set(key, null);
      return new BunContext(this.#span, m);
    }
    if (this.#extras === undefined || !this.#extras.$has(key)) return this;
    const m = new SafeMap(this.#extras);
    m.$delete(key);
    return new BunContext(this.#span, m.size ? m : undefined);
  }

  // Bun-internal accessors (not part of the api interface).
  get span() {
    return this.#span;
  }
  get extras() {
    return this.#extras;
  }
}

const ROOT_CONTEXT = new BunContext();

function activeContext(): BunContext {
  const span = nativeActiveSpan();
  const extras = activeExtras();
  if (span === undefined && extras === undefined) return ROOT_CONTEXT;
  return new BunContext(span, extras);
}

/** Read (span, extras) out of any api Context implementation, not just ours.
 *  extras: a Map, `null` (a Context with none — replaces the ambient ones) or
 *  `undefined` (not a Context — ambient extras are kept). */
function unpackContext(ctx: any): [any, Map<symbol, unknown> | null | undefined] {
  if (ctx instanceof BunContext) return [ctx.span, ctx.extras ?? null];
  if (ctx && typeof ctx.getValue === "function") {
    // Foreign Context (api's BaseContext keeps its values in `_currentContext`).
    const span = toNativeSpan(ctx.getValue(SPAN_KEY));
    const values = ctx._currentContext;
    if ($isMap(values)) {
      let extras: Map<symbol, unknown> | undefined;
      for (const [k, v] of values) {
        if (k !== SPAN_KEY) (extras ??= new SafeMap()).$set(k, v);
      }
      return [span, extras ?? null];
    }
    const bag = ctx.getValue(BAGGAGE_KEY);
    return [span, bag === undefined ? null : new SafeMap([[BAGGAGE_KEY, bag]])];
  }
  return [undefined, undefined];
}

let emptySpan: any;
/** Header placeholder for a Context that carries extras but no span. */
function placeholderSpan() {
  return (emptySpan ??= wrapSpanContext());
}

function runWithContext(ctx: any, fn: Function, thisArg: unknown, args: any[]) {
  const [span, extras] = unpackContext(ctx);
  const prev = enterContext(span ?? (extras ? placeholderSpan() : undefined), extras);
  try {
    return fn.$apply(thisArg, args);
  } finally {
    exitContext(prev);
  }
}

const kBoundEmitter = Symbol("otel.boundEmitter");
const contextManager = {
  active: activeContext,
  with(ctx: any, fn: Function, thisArg?: unknown, ...args: any[]) {
    return runWithContext(ctx, fn, thisArg, args);
  },
  bind(ctx: any, target: any) {
    if (typeof target === "function") {
      const bound = function (this: unknown, ...args: any[]) {
        return runWithContext(ctx, target, this, args);
      };
      ObjectDefineProperty(bound, "length", { configurable: true, value: target.length });
      return bound;
    }
    if (target && typeof target.emit === "function" && !target[kBoundEmitter]) {
      // (like AbstractAsyncHooksContextManager: binding an emitter twice is a no-op)
      const emit = target.emit;
      target.emit = function (this: unknown, ...args: any[]) {
        return runWithContext(ctx, emit, this, args);
      };
      target[kBoundEmitter] = true;
    }
    return target;
  },
  enable() {
    return this;
  },
  disable() {
    return this;
  },
};

// ── Tracer ────────────────────────────────────────────────────────────────
//
// Tracers are native (JSTelemetryTracer): startSpan/startActiveSpan never
// touch JS except to run the user callback.
const createTracer = $newCppFunction("JSTelemetryTracer.cpp", "jsTelemetryCreateTracer", 3);
type Tracer = {
  readonly name: string;
  readonly version: string | undefined;
  startSpan: Function;
  startActiveSpan: Function;
};

const tracers = new Map<string, Tracer>();
function getTracer(name?: string, version?: string): Tracer {
  // No name = the default scope Bun.otel.span/wrap use, exported as "bun".
  name = name ? name + "" : "bun";
  // NUL cannot appear in a package name, so "a@1" + undefined ≠ "a" + "1".
  const key = version ? name + "\0" + version : name;
  let t = tracers.$get(key);
  if (!t) {
    t = createTracer(createScope(name, version), name, version === undefined ? undefined : version + "");
    tracers.$set(key, t);
  }
  return t;
}

const tracerProvider = {
  getTracer,
  forceFlush: () => nativeForceFlush(),
  shutdown: () => nativeForceFlush(),
};

// ── W3C propagator (api TextMapPropagator) ────────────────────────────────

class Baggage {
  #entries: Map<string, { value: string; metadata?: unknown }>;
  constructor(entries?: Map<string, { value: string; metadata?: unknown }>) {
    this.#entries = entries ?? new SafeMap();
  }
  getEntry(key: string) {
    const e = this.#entries.$get(key);
    return e ? { ...e } : undefined;
  }
  getAllEntries() {
    return ArrayFrom(this.#entries, ([k, v]) => [k, { ...v }]);
  }
  setEntry(key: string, entry: { value: string }) {
    const m = new SafeMap(this.#entries);
    m.$set(key, entry);
    return new Baggage(m);
  }
  removeEntry(key: string) {
    const m = new SafeMap(this.#entries);
    m.$delete(key);
    return new Baggage(m);
  }
  removeEntries(...keys: string[]) {
    const m = new SafeMap(this.#entries);
    for (const k of keys) m.$delete(k);
    return new Baggage(m);
  }
  clear() {
    return new Baggage();
  }
}

function parseBaggage(header: string): Baggage | undefined {
  if (typeof header !== "string" || !header || header.length > 8192) return undefined;
  const m = new SafeMap();
  const parts: string[] = StringPrototypeSplit.$call(header, ",");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const semi = StringPrototypeIndexOf.$call(part, ";");
    const kv = semi === -1 ? part : StringPrototypeSlice.$call(part, 0, semi);
    const eq = StringPrototypeIndexOf.$call(kv, "=");
    if (eq <= 0) continue;
    let key = StringPrototypeTrim.$call(StringPrototypeSlice.$call(kv, 0, eq));
    let value = StringPrototypeTrim.$call(StringPrototypeSlice.$call(kv, eq + 1));
    if (!key) continue;
    try {
      key = decodeURIComponent_(key);
    } catch {}
    try {
      value = decodeURIComponent_(value);
    } catch {}
    const entry: any = { value };
    if (semi !== -1) {
      const meta = StringPrototypeTrim.$call(StringPrototypeSlice.$call(part, semi + 1));
      entry.metadata = { toString: () => meta };
    }
    m.$set(key, entry);
  }
  return m.size ? new Baggage(m) : undefined;
}

/** W3C `baggage` header for the Baggage in an active-slot extras Map, or "" (used natively). */
/** W3C `baggage` header for the Baggage in an active-slot extras Map (used natively):
 * the header, `""` when the Context says nothing about baggage (fall back to
 * what the request carried in), or `null` when it says "none" (deleted/empty). */
function baggageHeaderFromExtras(extras: unknown): string | null {
  if (!$isMap(extras) || !(extras as Map<symbol, unknown>).$has(BAGGAGE_KEY)) return "";
  const bag = (extras as Map<symbol, unknown>).$get(BAGGAGE_KEY);
  if (bag == null || typeof (bag as any).getAllEntries !== "function") return null;
  return serializeBaggage(bag) || null;
}

function serializeBaggage(bag: any): string {
  const parts: string[] = [];
  for (const [k, e] of bag.getAllEntries()) {
    let s = encodeURIComponent_(k) + "=" + encodeURIComponent_(e.value);
    const metadata = e.metadata;
    if (metadata !== undefined) s += ";" + metadata;
    $arrayPush(parts, s);
  }
  return ArrayPrototypeJoin.$call(parts, ",");
}

const defaultGetter = {
  get(carrier: any, key: string) {
    if (carrier == null) return undefined;
    if (typeof carrier.get === "function") return carrier.get(key) ?? undefined;
    return carrier[key];
  },
  keys(carrier: any) {
    if (carrier == null) return [];
    if (typeof carrier.keys === "function") return ArrayFrom(carrier.keys());
    return ObjectKeys(carrier);
  },
};
const defaultSetter = {
  set(carrier: any, key: string, value: string) {
    if (carrier == null) return;
    if (typeof carrier.set === "function") carrier.set(key, value);
    else carrier[key] = value;
  },
};

const propagator = {
  fields() {
    return ["traceparent", "tracestate", "baggage"];
  },
  inject(context: any, carrier: any, setter: any = defaultSetter) {
    const [span, extras] = unpackContext(context ?? activeContext());
    let incomingBaggage: string | undefined;
    if (span) {
      // The native side formats the headers and honours OTEL_PROPAGATORS.
      const [traceparent, tracestate, baggage] = propagationHeaders(span);
      if (traceparent) {
        setter.set(carrier, "traceparent", traceparent);
        if (tracestate) setter.set(carrier, "tracestate", tracestate);
      }
      incomingBaggage = baggage;
    }
    if (nativePropagationFlags() & 2) {
      // The Context's own Baggage (set or deleted in JS) wins over what the request carried in.
      const fromContext = baggageHeaderFromExtras(extras);
      const s = fromContext === "" ? incomingBaggage : fromContext;
      if (s) setter.set(carrier, "baggage", s);
    }
  },
  extract(context: any, carrier: any, getter: any = defaultGetter): BunContext {
    let ctx: BunContext = context instanceof BunContext ? context : new BunContext(...unpackContext(context));
    const flags = nativePropagationFlags();
    let tp = flags & 1 ? getter.get(carrier, "traceparent") : undefined;
    if ($isJSArray(tp)) tp = tp[0];
    if (typeof tp === "string") {
      let traceState = getter.get(carrier, "tracestate");
      if ($isJSArray(traceState)) traceState = ArrayPrototypeJoin.$call(traceState, ",");
      const span = parseTraceparent(tp, typeof traceState === "string" ? traceState : undefined);
      if (span) ctx = ctx.setValue(SPAN_KEY, span);
    }
    let bg = flags & 2 ? getter.get(carrier, "baggage") : undefined;
    if ($isJSArray(bg)) bg = ArrayPrototypeJoin.$call(bg, ",");
    if (typeof bg === "string") {
      const bag = parseBaggage(bg);
      if (bag) ctx = ctx.setValue(BAGGAGE_KEY, bag);
    }
    return ctx;
  },
};

// ── @opentelemetry/api global registration ────────────────────────────────

/**
 * Populate the api package's global registry so that every copy of
 * `@opentelemetry/api` (any 1.x) picks up the native provider. Called once
 * per global when telemetry is enabled. If user code already registered a
 * provider we leave it alone.
 */
/** The version of the `@opentelemetry/api` package the application would load
 * (its registerGlobal() compares the global's `version` for strict equality;
 * getGlobal() only needs the same major and minor >= its own). */
function installedApiVersion(): string {
  try {
    const from = (Bun.main || process.cwd() + "/") + "";
    const path = Bun.resolveSync("@opentelemetry/api/package.json", from);
    const { readFileSync } = require("node:fs");
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    if (typeof pkg?.version === "string") return pkg.version;
  } catch {}
  return "1.9.0";
}

function installGlobal() {
  const g = globalThis as any;
  let reg = g[API_KEY];
  if (!reg) {
    let version: string | undefined;
    reg = g[API_KEY] = {
      get version() {
        return (version ??= installedApiVersion());
      },
      set version(v) {
        version = v;
      },
    };
  }
  reg.trace ??= tracerProvider;
  reg.context ??= contextManager;
  reg.propagation ??= propagator;
}

/** An async function exporter returned `promise`: report its settlement natively. */
function awaitExport(promise: Promise<unknown>, exporterId: number, payloadId: number) {
  promise.then(
    () => nativeExportSettled(exporterId, payloadId, true),
    (e: any) => {
      console.warn("[otel] exporter callback failed:", e?.message ?? e);
      nativeExportSettled(exporterId, payloadId, false);
    },
  );
}

// ── node:http client (see _http_client.ts) ────────────────────────────────

const httpClientInstrument = nativeInstrumentId("fetch") as number;
/** A CLIENT span under the active span, or undefined when disabled. */
const REDACTED_QUERY_KEYS = ["sig", "Signature", "AWSAccessKeyId", "X-Goog-Signature"];
/** `path` with credential query values (presigned URLs) replaced by REDACTED. */
function redactQuery(path: string): string {
  const q = StringPrototypeIndexOf.$call(path, "?");
  if (q === -1) return path;
  let hit = false;
  for (let i = 0; i < REDACTED_QUERY_KEYS.length && !hit; i++)
    hit = StringPrototypeIndexOf.$call(path, REDACTED_QUERY_KEYS[i] + "=", q) !== -1;
  if (!hit) return path;
  const hash = StringPrototypeIndexOf.$call(path, "#", q);
  const end = hash === -1 ? path.length : hash;
  const pairs: string[] = StringPrototypeSplit.$call(StringPrototypeSlice.$call(path, q + 1, end), "&");
  for (let i = 0; i < pairs.length; i++) {
    const eq = StringPrototypeIndexOf.$call(pairs[i], "=");
    const key = eq === -1 ? pairs[i] : StringPrototypeSlice.$call(pairs[i], 0, eq);
    for (let k = 0; k < REDACTED_QUERY_KEYS.length; k++)
      if (key === REDACTED_QUERY_KEYS[k]) {
        pairs[i] = key + "=REDACTED";
        break;
      }
  }
  return (
    StringPrototypeSlice.$call(path, 0, q + 1) +
    ArrayPrototypeJoin.$call(pairs, "&") +
    StringPrototypeSlice.$call(path, end)
  );
}

function startClientSpan(name: string, callerTraceparent?: string) {
  return startInstrumentSpan(httpClientInstrument, name + "", SpanKind.CLIENT, callerTraceparent);
}

// ── Bun.otel ──────────────────────────────────────────────────────────────

function start(options?: any) {
  nativeStart(options);
}

async function shutdown() {
  await nativeForceFlush();
  nativeSetEnabled(0, 0);
}

// W3C tracestate as an @opentelemetry/api `TraceState` (immutable; set/unset
// return new instances). Parsed lazily; `serialize()` of an untouched instance
// returns the header as received.
class TraceState {
  #raw: string;
  #map: Map<string, string> | undefined;
  constructor(raw?: string) {
    this.#raw = typeof raw === "string" ? raw : "";
  }
  #entries(): Map<string, string> {
    let m = this.#map;
    if (m === undefined) {
      m = new SafeMap();
      const raw = this.#raw;
      if (raw.length) {
        const parts: string[] = StringPrototypeSplit.$call(raw, ",");
        // Right-most duplicate loses; cap at 32 members (spec).
        for (let i = 0; i < parts.length && m.size < 32; i++) {
          const part = StringPrototypeTrim.$call(parts[i]);
          const eq = StringPrototypeIndexOf.$call(part, "=");
          if (eq <= 0) continue;
          const k = StringPrototypeSlice.$call(part, 0, eq);
          if (!m.$has(k)) m.$set(k, StringPrototypeSlice.$call(part, eq + 1));
        }
      }
      this.#map = m;
    }
    return m;
  }
  get(key: string): string | undefined {
    return this.#entries().$get(key);
  }
  set(key: string, value: string): TraceState {
    const next = new TraceState();
    const m = new SafeMap<string, string>();
    m.$set(key, value); // a modified key moves to the front
    // W3C: at most 32 members; the oldest fall off (as @opentelemetry/api does).
    for (const [k, v] of this.#entries()) if (k !== key && m.size < 32) m.$set(k, v);
    next.#map = m;
    return next;
  }
  unset(key: string): TraceState {
    const next = new TraceState();
    const m = new SafeMap(this.#entries());
    m.$delete(key);
    next.#map = m;
    return next;
  }
  serialize(): string {
    if (this.#map === undefined) return this.#raw;
    let out = "";
    for (const [k, v] of this.#map) out += (out ? "," : "") + k + "=" + v;
    return out;
  }
}

function makeTraceState(raw: string) {
  return new TraceState(raw);
}

// ── Bun.otel.span / wrap / set ────────────────────────────────────────────
//
// All native: `span` and the functions `wrap` returns are JSTracedFunctions
// (a JIT thunk runs JSTelemetryTracer.cpp's enter/leave hooks around a direct
// call), and `set` writes to the active span without a Span object.
const span = $cpp("JSTelemetryTracer.cpp", "createTelemetrySpanFunction");
const wrapFunction = $newCppFunction("JSTelemetryTracer.cpp", "jsTelemetryOtelWrap", 2);
const set = $newCppFunction("JSTelemetryTracer.cpp", "jsTelemetryOtelSet", 2);

/** Run `fn` with `span` (a Span, SpanContext-like object, or api Context) active. */
function withActive(spanOrContext: any, fn: Function, thisArg?: unknown, ...args: any[]) {
  if (spanOrContext && typeof spanOrContext.getValue === "function") {
    return runWithContext(spanOrContext, fn, thisArg, args);
  }
  const span = toNativeSpan(spanOrContext);
  // No span: run with no active span (like ROOT_CONTEXT), keeping ALS stores.
  if (span === undefined) return runWithContext(ROOT_CONTEXT, fn, thisArg, args);
  return withContext(span, fn, thisArg, ...args);
}

/** `Bun.otel`. */
const bunOtel = {
  start,
  span,
  wrap: wrapFunction,
  set,
  tracer: getTracer,
  activeSpan: nativeActiveSpan,
  with: withActive,
  forceFlush: () => nativeForceFlush(),
  shutdown,
  stats: nativeStats,
  decode: nativeDecode,
  get enabled() {
    return nativeIsEnabled();
  },
  // api-compatible building blocks, for manual wiring
  // (`trace.setGlobalTracerProvider(Bun.otel.tracerProvider)` etc.)
  tracerProvider,
  contextManager,
  propagator,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `Bun.otel { enabled: ${nativeIsEnabled()} }`;
  },
};

// The module's exports: `Bun.otel` plus helpers for node:http,
// JSTelemetrySpan.cpp and JSTelemetryTracer.cpp (not user-reachable).
export default {
  bunOtel,
  installGlobal,
  startClientSpan,
  redactQuery,
  awaitExport,
  propagationHeaders,
  unpackContext,
  toNativeSpan,
  makeTraceState,
  baggageHeaderFromExtras,
  TraceState,
};
