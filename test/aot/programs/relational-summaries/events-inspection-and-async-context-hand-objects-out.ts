// The host's own machinery hands operands on to code of the program: an emitter to its listeners, an event target to its handlers, an inspector to a custom inspect method, an async context to whoever asks for the store later, `process` to the handlers of `exit`, a channel to the other port. A helper that passes an object to one of these has let it go.
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { inspect } from "node:util";
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Thing {
  n: number;
  tag: string;
}
const kept: Thing[] = [];
const report = () => kept.splice(0).map(k => k.tag).join(" | ");
const rare = (t: Thing) => t.n % 60 === 59;

// An emitter.
const emitter = new EventEmitter();
emitter.on("thing", (t: Thing) => void (rare(t) && kept.push(t)));
emitter.once("first", (t: Thing) => void kept.push(t));
function emit(t: Thing): boolean {
  return emitter.emit("thing", t);
}
function emitTwo(a: Thing, b: Thing): boolean {
  return emitter.emit("nobody listens", a) || emitter.emit("first", b);
}
let listened = 0;
for (let i = 0; i < 120; i++) listened += (emit({ n: i, tag: "emitted " + i }) ? 1 : 0) + (emitTwo({ n: i, tag: "unheard " + i }, { n: i, tag: "heard once " + i }) ? 1 : 0);
console.log(listened, churn(60), report());

// The listener is a closure made for the registration; the emitter keeps it.
function subscribe(i: number): void {
  const state = { tag: "subscriber " + i, calls: 0 };
  emitter.on("ping", () => {
    state.calls++;
    kept.push({ n: state.calls, tag: state.tag + " called " + state.calls });
  });
}
for (let i = 0; i < 3; i++) subscribe(i);
churn(60);
emitter.emit("ping");
emitter.emit("ping");
console.log(report());

// An event target.
const target = new EventTarget();
const events: Event[] = [];
target.addEventListener("custom", event => void events.push(event));
function dispatch(i: number): boolean {
  return target.dispatchEvent(new CustomEvent("custom", { detail: { n: i, tag: "detail " + i } }));
}
for (let i = 0; i < 3; i++) dispatch(i);
const handlerObject = {
  tag: "a handler object",
  n: 0,
  handleEvent(this: Thing) {
    kept.push(this);
  },
};
target.addEventListener("object", handlerObject);
target.dispatchEvent(new Event("object"));
console.log(churn(60), events.map(e => (e as CustomEvent<Thing>).detail.tag).join(" | "), report());
const controller = new AbortController();
function abortWith(reason: Thing): void {
  controller.abort(reason);
}
controller.signal.addEventListener("abort", () => kept.push(controller.signal.reason));
abortWith({ n: 0, tag: "the reason of an abort" });
console.log(churn(30), report(), (controller.signal.reason as Thing).tag);

// Inspection.
class Inspected {
  constructor(public tag: string) {}
  n = 0;
  [inspect.custom](): string {
    kept.push(this);
    return "custom<" + this.tag + ">";
  }
}
function show(x: unknown): string {
  return inspect(x);
}
function showNested(x: unknown): string {
  return inspect({ inner: [x] });
}
console.log(show({ a: 1 }), show(new Inspected("inspected")), showNested(new Inspected("nested")), Bun.inspect(new Inspected("by Bun.inspect")), `${inspect(new Inspected("in a template"))}`);
console.log(new Inspected("by console.log"));
console.log("%s %o", "formatted", new Inspected("by a format"));
console.log(churn(30), report());

// An async context.
const context = new AsyncLocalStorage<Thing>();
function runWith(store: Thing, body: () => unknown): unknown {
  return context.run(store, body);
}
const later: Promise<string>[] = [];
for (let i = 0; i < 100; i++) {
  runWith({ n: i, tag: "store " + i }, () => {
    if (i % 45 !== 44) return context.getStore()!.n;
    later.push(
      (async () => {
        await null;
        await new Promise(resolve => setTimeout(resolve, 1));
        return context.getStore()!.tag;
      })(),
    );
    setTimeout(() => kept.push(context.getStore()!), 0);
    queueMicrotask(() => kept.push(context.getStore()!));
  });
}
churn(60);
console.log((await Promise.all(later)).join(" | "), context.getStore());
console.log(churn(30), report());
function sameStore(i: number): boolean {
  const store = { n: i, tag: "identity " + i };
  return runWith(store, () => context.getStore() === store) as boolean;
}
let sameStores = 0;
for (let i = 0; i < 100; i++) if (sameStore(i)) sameStores++;
console.log(sameStores);

// A channel copies.
const channel = new MessageChannel();
const received: Thing[] = [];
const done = new Promise<void>(resolve => {
  channel.port2.onmessage = event => {
    received.push(event.data);
    if (received.length === 2) resolve();
  };
});
function post(t: Thing): Thing {
  channel.port1.postMessage(t);
  t.tag += " (changed after posting)";
  return t;
}
const posted = [post({ n: 1, tag: "posted one" }), post({ n: 2, tag: "posted two" })];
await done;
channel.port1.close();
console.log(received.map(t => t.tag).join(" | "), posted.map(t => t.tag).join(" | "), received[0] === posted[0]);

// Handlers of `exit` run last of all.
function atExit(t: Thing): void {
  process.on("exit", () => console.log("at exit:", t.tag, churn(10)));
}
for (let i = 0; i < 2; i++) atExit({ n: i, tag: "kept until the exit " + i });
churn(60);
