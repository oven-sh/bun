// Only native code calls the methods of these classes, under the names that @opentelemetry/api gives them.
Bun.otel.start({ exporters: [], instrumentations: [] });
const { contextManager, propagator, tracerProvider, ROOT_CONTEXT } = Bun.otel;
const SPAN = Symbol.for("OpenTelemetry Context Key SPAN");
const BAGGAGE = Symbol.for("OpenTelemetry Baggage Key");
const OWN = Symbol.for("own");

class ForeignContext {
  constructor(private values = new Map<symbol, unknown>()) {}
  getValue(key: symbol) {
    return this.values.get(key);
  }
  setValue(key: symbol, value: unknown) {
    return new ForeignContext(new Map(this.values).set(key, value));
  }
  deleteValue(key: symbol) {
    const values = new Map(this.values);
    values.delete(key);
    return new ForeignContext(values);
  }
}
class ForeignTraceState {
  serialize() {
    return "foreign=1";
  }
}
class ForeignSpan {
  spanContext() {
    return { traceId: "1".repeat(32), spanId: "2".repeat(16), traceFlags: 1, traceState: new ForeignTraceState() };
  }
}
class ForeignBaggage {
  getAllEntries() {
    return [["k y", { value: "v,1", metadata: { toString: () => "meta" } }]];
  }
}
class Emitter {
  emit(event: string) {
    return event + " " + contextManager.active().getValue(OWN);
  }
}

const foreignSpan = new ForeignSpan();
const foreign = new ForeignContext()
  .setValue(SPAN, foreignSpan)
  .setValue(BAGGAGE, new ForeignBaggage())
  .setValue(OWN, 1);
contextManager.with(foreign, () => {
  const active = contextManager.active();
  console.log(active === foreign, active.getValue(SPAN) === foreignSpan);
  tracerProvider.getTracer("t").startActiveSpan("child", child => {
    console.log(child.traceId, child.parentSpanId, child.spanContext().traceState?.set("a", "b").serialize());
    console.log(contextManager.active().getValue(OWN), contextManager.active().deleteValue(OWN).getValue(OWN));
    child.end();
  });
});

const carrier: { traceparent?: string; tracestate?: string; baggage?: string } = {};
propagator.inject(foreign, carrier);
console.log(carrier.traceparent, carrier.tracestate, carrier.baggage);
const written: string[] = [];
propagator.inject(foreign, written, { set: (list, key, value) => (list as string[]).push(key + ":" + value) });
console.log(written);

const extracted = propagator.extract(ROOT_CONTEXT, carrier, {
  get: (from, key) => (from as Record<string, string>)[key],
  keys: from => Object.keys(from as object),
});
console.log((extracted.getValue(SPAN) as Bun.otel.Span).spanContext().isRemote);
console.log((extracted.getValue(BAGGAGE) as any).setEntry("n", { value: "1" }).removeEntries("x").getAllEntries());

const emitter = new Emitter();
console.log(emitter.emit("before"), contextManager.bind(foreign, emitter).emit("after"), emitter.emit("again"));
console.log(contextManager.bind(foreign, (x: number) => x + (contextManager.active().getValue(OWN) as number))(1));

const token = contextManager.attach(foreign);
console.log(contextManager.active() === foreign, token.dispose(), contextManager.active() === ROOT_CONTEXT);

const registry = (globalThis as any)[Symbol.for("opentelemetry.js.api.1")];
console.log(
  registry.trace === tracerProvider,
  registry.context === contextManager,
  registry.propagation === propagator,
);
