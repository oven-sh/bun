// Tracing and bounded channels enter and leave the stores that are bound to them.
import { AsyncLocalStorage } from "node:async_hooks";
import * as dc from "node:diagnostics_channel";

const store = new AsyncLocalStorage<any>();
const tracing = dc.tracingChannel<object, any>("traced");
console.log(tracing.hasSubscribers);
tracing.start.bindStore(store, (context: any) => "start " + context.name);
tracing.asyncStart.bindStore(store, (context: any) => "asyncStart " + context.name);
for (const event of ["start", "end", "asyncStart", "asyncEnd", "error"] as const) {
  tracing[event].subscribe((context: any) => console.log(event, JSON.stringify(context), store.getStore()));
}
console.log(tracing.hasSubscribers);

console.log(tracing.traceSync(() => store.getStore(), { name: "sync" }));
try {
  tracing.traceSync(
    () => {
      throw "thrown";
    },
    Object.freeze({ name: "frozen" }),
  );
} catch (error) {
  console.log(error);
}
tracing.traceCallback(
  (done: Function) => done(null, 1),
  0,
  { name: "callback" },
  undefined,
  () => console.log(store.getStore()),
);
const promise = Promise.resolve(2);
console.log(tracing.tracePromise(() => promise, { name: "promise" }) === (promise as unknown));
await promise;
await (tracing.tracePromise(() => Promise.reject("rejected"), { name: "rejects" }) as any).catch(console.log);

const bounded = (dc as any).boundedChannel("bounded");
bounded.start.bindStore(store, () => "bounded");
bounded.subscribe({ end: (context: unknown) => console.log("end", JSON.stringify(context), store.getStore()) });
{
  using scope = bounded.withScope();
  console.log(store.getStore());
}
console.log(
  bounded.run({ a: 1 }, (a: number, b: number) => a + b, undefined, 1, 2),
  store.getStore(),
);

dc.subscribe("nobody holds it", message => console.log(message));
await new Promise(resolve => setImmediate(resolve));
Bun.gc(true);
dc.channel("nobody holds it").publish("heard");
console.log((null as any) instanceof dc.Channel, dc.channel("a") instanceof dc.Channel);
