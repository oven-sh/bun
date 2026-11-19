// What a span is given reaches the exporter, whatever the compiler knows of the objects that hold it.
const spans: Bun.otel.ExportedSpan[] = [];
Bun.otel.start({
  serviceName: "compiled",
  resourceAttributes: { team: "core", shard: 3 },
  exporters: [{ export: batch => void spans.push(...batch) }],
  instrumentations: [],
  limits: { attributeCountLimit: 6 },
});

class Order {
  id = 7;
  total = 12.5;
  #secret = "hidden";
  get inherited() {
    return this.#secret;
  }
}
class PaymentError extends Error {
  code = "E_PAYMENT";
}

const tracer = Bun.otel.tracer("shop", "1.0.0");
const literal = { text: "a", int: 1, float: 1.5, flag: true, list: ["x", "y"], numbers: [1, 2.5] };
tracer.startSpan("literal", { kind: "client", attributes: literal }).end();
tracer
  .startSpan("instance")
  .setAttributes(new Order() as any)
  .end();
tracer
  .startSpan("getter")
  .set({
    get computed() {
      return 6 * 7;
    },
  })
  .end();
const grown: Record<string, number> = { first: 0 };
for (let i = 0; i < 9; i++) grown["key" + i] = i;
tracer.startSpan("grown").set(grown).end();

const linked = tracer.startSpan("linked");
tracer
  .startSpan("rich", { links: [{ context: linked.spanContext(), attributes: { why: "batch" } }], startTime: [5, 0] })
  .addEvent("event", { n: 1 }, new Date(6000))
  .setStatus({ code: Bun.otel.SpanStatusCode.ERROR, message: "bad" })
  .updateName("renamed")
  .end(new Date(7000));
linked.end();

for (let i = 0; i < 3; i++) Bun.otel.span("loop", { i }, span => span.set("twice", i * 2));

const charge = Bun.otel.wrap(function charge(this: { rate: number }, amount: number, ...rest: number[]) {
  if (amount < 0) throw new PaymentError("negative");
  return amount * this.rate + rest.length;
});
console.log(charge.name, charge.length, charge.call({ rate: 2 }, 4, 1, 1));
try {
  charge.call({ rate: 2 }, -1);
} catch (error) {
  console.log(error instanceof PaymentError, Bun.otel.activeSpan());
}
for (const thrown of [{ message: "plain", code: "E_PLAIN" }, Object.create(new PaymentError("inherited"))]) {
  try {
    Bun.otel.span("throws", () => {
      throw thrown;
    });
  } catch {}
}
for (const refused of [class {}, function* generator() {}, async function* asyncGenerator() {}, () => {}]) {
  try {
    Bun.otel.wrap(refused as any);
  } catch (error) {
    console.log((error as Error).message);
  }
}

class Lazy extends Promise<string> {
  then(resolve?: ((value: string) => any) | null): any {
    return resolve!(Bun.otel.activeSpan()!.name);
  }
}
console.log(await Bun.otel.span("lazy", () => new Lazy(() => {})));
console.log(
  await Bun.otel.span("thenable", () => ({ then: (f: (value?: string) => void) => f(Bun.otel.activeSpan()?.name) })),
);
await Bun.otel
  .span("rejects", async () => {
    await 1;
    throw new PaymentError("later");
  })
  .catch(error => console.log(error.message));

await Bun.otel.forceFlush();
for (const { name, kind, attributes, status, scope, events, links, droppedAttributesCount } of spans) {
  console.log(
    JSON.stringify({
      name,
      kind,
      attributes,
      status,
      scope: scope.name,
      events: events.map(e => [e.name, e.attributes["exception.type"] ?? e.time, e.attributes.n]),
      links: links.map(l => [l.spanId === linked.spanId, l.attributes]),
      droppedAttributesCount,
    }),
  );
}
const { attributes } = spans[0].resource;
console.log(attributes["service.name"], attributes.team, attributes.shard, Bun.otel.enabled);
