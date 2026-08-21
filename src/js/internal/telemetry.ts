// Bun.otel — native OpenTelemetry tracing.
//
// Native side: src/runtime/telemetry.rs (host functions below), the
// TelemetrySpan class (src/runtime/telemetry/span.rs), and the async-context
// slot helpers in BunTelemetry.cpp. This module is the JS surface: `Bun.otel`
// itself plus objects that satisfy the @opentelemetry/api TracerProvider /
// ContextManager / TextMapPropagator interfaces so `trace.getTracer()` etc.
// resolve to the native pipeline with no SDK installed.

const nativeStart = $newRustFunction("telemetry.rs", "start", 1);
const nativeIsEnabled = $newRustFunction("telemetry.rs", "isEnabled", 0);
const createScope = $newRustFunction("telemetry.rs", "createScope", 2);
const nativeActiveSpan = $newRustFunction("telemetry.rs", "activeSpan", 0);
const wrapSpanContext = $newCppFunction("BunTelemetry.cpp", "jsTelemetryWrapSpanContext", 1);
const withContext = $newRustFunction("telemetry.rs", "withContext", 3);
const nativeForceFlush = $newRustFunction("telemetry.rs", "forceFlush", 0);
const nativeStats = $newRustFunction("telemetry.rs", "stats", 0);
const nativeDecode = $newRustFunction("telemetry.rs", "decode", 1);
const nativeSetEnabled = $newRustFunction("telemetry.rs", "setEnabled", 2);
const nativePropagationFlags = $newRustFunction("telemetry.rs", "propagationFlags", 0);
const nativeStartLeafSpan = $newCppFunction("BunTelemetry.cpp", "jsTelemetryStartInstrumentSpan", 3);
const enterWithExtras = $newCppFunction("BunTelemetry.cpp", "jsEnterWithExtras", 2);
const exitContext = $newCppFunction("BunTelemetry.cpp", "jsExitContext", 1);
const activeExtras = $newCppFunction("BunTelemetry.cpp", "jsActiveExtras", 0);

// @opentelemetry/api well-known keys (createContextKey === Symbol.for).
const SPAN_KEY = Symbol.for("OpenTelemetry Context Key SPAN");
const BAGGAGE_KEY = Symbol.for("OpenTelemetry Baggage Key");
const API_KEY = Symbol.for("opentelemetry.js.api.1");

const SpanKind = { INTERNAL: 0, SERVER: 1, CLIENT: 2, PRODUCER: 3, CONSUMER: 4 } as const;
const SpanStatusCode = { UNSET: 0, OK: 1, ERROR: 2 } as const;

/** Coerce anything span-like (ours, or a foreign api NonRecordingSpan) to a TelemetrySpan. */
function toNativeSpan(span: any) {
  if (span == null) return undefined;
  if ($isTelemetrySpan(span)) return span;
  if (typeof span.spanContext === "function") return wrapSpanContext(span.spanContext());
  if (typeof span.traceId === "string") return wrapSpanContext(span);
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

  constructor(span?: any, extras?: Map<symbol, unknown>) {
    this.#span = span;
    this.#extras = extras;
  }

  getValue(key: symbol): unknown {
    if (key === SPAN_KEY) return this.#span;
    return this.#extras?.get(key);
  }

  setValue(key: symbol, value: unknown): BunContext {
    if (key === SPAN_KEY) return new BunContext(toNativeSpan(value), this.#extras);
    const m = new Map(this.#extras);
    m.set(key, value);
    return new BunContext(this.#span, m);
  }

  deleteValue(key: symbol): BunContext {
    if (key === SPAN_KEY) return new BunContext(undefined, this.#extras);
    if (!this.#extras?.has(key)) return this;
    const m = new Map(this.#extras);
    m.delete(key);
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

/** Read (span, extras) out of any api Context implementation, not just ours. */
function unpackContext(ctx: any): [any, Map<symbol, unknown> | undefined] {
  if (ctx instanceof BunContext) return [ctx.span, ctx.extras];
  if (ctx && typeof ctx.getValue === "function") {
    // Foreign Context (api's BaseContext keeps its values in `_currentContext`).
    const span = toNativeSpan(ctx.getValue(SPAN_KEY));
    const values = ctx._currentContext;
    if ($isMap(values)) {
      let extras: Map<symbol, unknown> | undefined;
      for (const [k, v] of values) {
        if (k !== SPAN_KEY) (extras ??= new Map()).set(k, v);
      }
      return [span, extras];
    }
    const bag = ctx.getValue(BAGGAGE_KEY);
    return [span, bag === undefined ? undefined : new Map([[BAGGAGE_KEY, bag]])];
  }
  return [undefined, undefined];
}

let emptySpan: any;
/** Header placeholder for a Context that carries extras but no span. */
function placeholderSpan() {
  return (emptySpan ??= wrapSpanContext(null));
}

function runWithContext(ctx: any, fn: Function, thisArg: unknown, args: any[]) {
  const [span, extras] = unpackContext(ctx);
  const prev = enterWithExtras(span ?? (extras ? placeholderSpan() : undefined), extras);
  try {
    return fn.$apply(thisArg, args);
  } finally {
    exitContext(prev);
  }
}

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
      Object.defineProperty(bound, "length", { configurable: true, value: target.length });
      return bound;
    }
    if (target && typeof target.emit === "function") {
      const emit = target.emit;
      target.emit = function (this: unknown, ...args: any[]) {
        return runWithContext(ctx, emit, this, args);
      };
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
const createTracer = $newCppFunction("BunTelemetry.cpp", "jsTelemetryCreateTracer", 3);
type Tracer = {
  readonly name: string;
  readonly version: string | undefined;
  startSpan: Function;
  startActiveSpan: Function;
};

const tracers = new Map<string, Tracer>();
function getTracer(name?: string, version?: string): Tracer {
  name = name ? String(name) : "";
  const key = version ? name + "@" + version : name;
  let t = tracers.get(key);
  if (!t) {
    t = createTracer(createScope(name, version), name, version === undefined ? undefined : String(version));
    tracers.set(key, t);
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
    this.#entries = entries ?? new Map();
  }
  getEntry(key: string) {
    const e = this.#entries.get(key);
    return e ? { ...e } : undefined;
  }
  getAllEntries() {
    return Array.from(this.#entries, ([k, v]) => [k, { ...v }]);
  }
  setEntry(key: string, entry: { value: string }) {
    const m = new Map(this.#entries);
    m.set(key, entry);
    return new Baggage(m);
  }
  removeEntry(key: string) {
    const m = new Map(this.#entries);
    m.delete(key);
    return new Baggage(m);
  }
  removeEntries(...keys: string[]) {
    const m = new Map(this.#entries);
    for (const k of keys) m.delete(k);
    return new Baggage(m);
  }
  clear() {
    return new Baggage();
  }
}

function parseBaggage(header: string): Baggage | undefined {
  if (!header || header.length > 8192) return undefined;
  const m = new Map();
  for (const part of header.split(",")) {
    const semi = part.indexOf(";");
    const kv = semi === -1 ? part : part.slice(0, semi);
    const eq = kv.indexOf("=");
    if (eq <= 0) continue;
    const key = kv.slice(0, eq).trim();
    let value = kv.slice(eq + 1).trim();
    if (!key) continue;
    try {
      value = decodeURIComponent(value);
    } catch {}
    const entry: any = { value };
    if (semi !== -1) entry.metadata = { toString: () => part.slice(semi + 1).trim() };
    m.set(key, entry);
  }
  return m.size ? new Baggage(m) : undefined;
}

function serializeBaggage(bag: any): string {
  const parts: string[] = [];
  for (const [k, e] of bag.getAllEntries()) {
    let s = encodeURIComponent(k) + "=" + encodeURIComponent(e.value);
    const metadata = e.metadata;
    if (metadata !== undefined) s += ";" + String(metadata);
    parts.push(s);
  }
  return parts.join(",");
}

const defaultGetter = {
  get(carrier: any, key: string) {
    if (carrier == null) return undefined;
    if (typeof carrier.get === "function") return carrier.get(key) ?? undefined;
    return carrier[key];
  },
  keys(carrier: any) {
    if (carrier == null) return [];
    if (typeof carrier.keys === "function") return Array.from(carrier.keys());
    return Object.keys(carrier);
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
    const flags = nativePropagationFlags();
    const [span, extras] = unpackContext(context ?? activeContext());
    if (span && flags & 1) {
      const ctx = span.spanContext();
      const traceId = ctx.traceId;
      if (traceId && traceId !== "00000000000000000000000000000000") {
        setter.set(
          carrier,
          "traceparent",
          "00-" + traceId + "-" + ctx.spanId + "-" + (ctx.traceFlags & 0xff).toString(16).padStart(2, "0"),
        );
        const ts = ctx.traceState;
        if (ts) setter.set(carrier, "tracestate", typeof ts === "string" ? ts : ts.serialize());
      }
    }
    const bag = extras?.get(BAGGAGE_KEY);
    if (bag && flags & 2) {
      const s = serializeBaggage(bag);
      if (s) setter.set(carrier, "baggage", s);
    }
  },
  extract(context: any, carrier: any, getter: any = defaultGetter): BunContext {
    let ctx: BunContext = context instanceof BunContext ? context : new BunContext(...unpackContext(context));
    let tp = getter.get(carrier, "traceparent");
    if ($isJSArray(tp)) tp = tp[0];
    if (typeof tp === "string") {
      const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/.exec(tp.trim());
      if (m && m[1] !== "ff" && !(m[1] === "00" && m[5]) && !/^0+$/.test(m[2]) && !/^0+$/.test(m[3])) {
        let traceState = getter.get(carrier, "tracestate");
        if ($isJSArray(traceState)) traceState = traceState.join(",");
        const span = wrapSpanContext({
          traceId: m[2],
          spanId: m[3],
          traceFlags: parseInt(m[4], 16),
          isRemote: true,
          traceState: typeof traceState === "string" ? traceState : undefined,
        });
        ctx = ctx.setValue(SPAN_KEY, span);
      }
    }
    let bg = getter.get(carrier, "baggage");
    if ($isJSArray(bg)) bg = bg.join(",");
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
function installGlobal() {
  const g = globalThis as any;
  let reg = g[API_KEY];
  if (!reg) {
    // Highest 1.x minor we claim compatibility with; the api accepts a global
    // whose minor is >= its own.
    reg = g[API_KEY] = { version: "1.999.0" };
  }
  reg.trace ??= tracerProvider;
  reg.context ??= contextManager;
  reg.propagation ??= propagator;
}

// ── node:http client (see _http_client.ts) ────────────────────────────────

const clientScopeId = 1; // bun_telemetry::Instrument::HttpClient
/** A CLIENT span under the active span, or undefined when disabled. */
function startClientSpan(name: string) {
  return nativeStartLeafSpan(clientScopeId, String(name), SpanKind.CLIENT);
}
const propagationHeaders = $newCppFunction("BunTelemetry.cpp", "jsTelemetryPropagationHeaders", 1);

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
      m = new Map();
      const raw = this.#raw;
      if (raw.length) {
        const parts = raw.split(",");
        // Right-most duplicate loses; cap at 32 members (spec).
        for (let i = 0; i < parts.length && m.size < 32; i++) {
          const part = parts[i].trim();
          const eq = part.indexOf("=");
          if (eq <= 0) continue;
          const k = part.slice(0, eq);
          if (!m.has(k)) m.set(k, part.slice(eq + 1));
        }
      }
      this.#map = m;
    }
    return m;
  }
  get(key: string): string | undefined {
    return this.#entries().get(key);
  }
  set(key: string, value: string): TraceState {
    const next = new TraceState();
    const m = new Map<string, string>();
    m.set(key, value); // a modified key moves to the front
    for (const [k, v] of this.#entries()) if (k !== key) m.set(k, v);
    next.#map = m;
    return next;
  }
  unset(key: string): TraceState {
    const next = new TraceState();
    const m = new Map(this.#entries());
    m.delete(key);
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

export default {
  start,
  tracer: getTracer,
  activeSpan: nativeActiveSpan,
  /** Run `fn` with `span` (a Span, SpanContext-like object, or api Context) active. */
  with(spanOrContext: any, fn: Function, thisArg?: unknown, ...args: any[]) {
    if (spanOrContext && typeof spanOrContext.getValue === "function") {
      return runWithContext(spanOrContext, fn, thisArg, args);
    }
    return withContext(toNativeSpan(spanOrContext), fn, thisArg, ...args);
  },
  forceFlush: () => nativeForceFlush(),
  shutdown,
  stats: nativeStats,
  decode: nativeDecode,
  get enabled() {
    return nativeIsEnabled();
  },
  installGlobal,
  // api-compatible building blocks, for manual wiring
  // (`trace.setGlobalTracerProvider(Bun.otel.tracerProvider)` etc.)
  tracerProvider,
  contextManager,
  propagator,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  // internal, for node:http and JSTelemetrySpan.cpp
  startClientSpan,
  propagationHeaders,
  unpackContext,
  makeTraceState,
  TraceState,
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `Bun.otel { enabled: ${nativeIsEnabled()} }`;
  },
};
