// process.nextTick() and EventEmitter's on(), once(), prependListener(), off() with what is no function: the error, its code and its words; and with what is one: the order of the ticks and their arguments. The Proxy without traps among the values is described by its target, as plain Bun describes it.
import { EventEmitter } from "node:events";

function attempt(what: string, act: () => unknown): void {
  try {
    act();
    console.log(what + ": taken");
  } catch (error) {
    const thrown = error as Error & { code?: string };
    console.log(what + ": " + thrown.constructor.name + " " + thrown.code + " " + thrown.message);
  }
}
const values: unknown[] = [undefined, null, 0, "text", {}, [], Symbol("s"), 1n, true, { call() {} }, new Proxy({}, {})];
const emitter = new EventEmitter();
for (const value of values) {
  const name = typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? "bigint" : JSON.stringify(value) ?? "undefined";
  attempt("nextTick " + name, () => process.nextTick(value as any));
  attempt("on " + name, () => emitter.on("x", value as any));
  attempt("once " + name, () => emitter.once("x", value as any));
  attempt("prependListener " + name, () => emitter.prependListener("x", value as any));
  attempt("off " + name, () => emitter.off("x", value as any));
}
console.log(emitter.listenerCount("x"));
const order: string[] = [];
class Callable { static run(this: void, ...all: unknown[]): void { order.push("static " + all.join()); } }
const functions: ((...all: unknown[]) => void)[] = [
  (...all) => order.push("arrow " + all.join()),
  function (...all) { order.push("function " + all.join()); },
  async (...all) => { order.push("async " + all.join()); },
  Callable.run,
  ((...all: unknown[]) => order.push("bound " + all.join())).bind(null, "first"),
  new Proxy((...all: unknown[]) => { order.push("proxy " + all.join()); }, {}),
];
for (const each of functions) {
  process.nextTick(each);
  process.nextTick(each, 1);
  process.nextTick(each, 1, 2, 3, 4, 5);
  emitter.once("y", each);
}
emitter.emit("y", "emitted");
process.nextTick(() => console.log(order.join("\n")));
