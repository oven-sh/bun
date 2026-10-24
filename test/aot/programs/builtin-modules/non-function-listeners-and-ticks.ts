// What node:events and process.nextTick say to a listener or a callback that is no function, and that functions of every kind are taken.
import { EventEmitter } from "node:events";
const attempt = (run: () => unknown): string => {
  try {
    return "returned " + typeof run();
  } catch (error: any) {
    return error.constructor.name + " " + error.code + " " + error.message;
  }
};
const values: unknown[] = [undefined, null, 0, 1, "", "text", true, Symbol.iterator, 1n, {}, [], /x/, new Map(), { call() {} }, Object.create(Function.prototype)];
const methods = ["on", "addListener", "once", "prependListener", "prependOnceListener", "off", "removeListener"] as const;
for (const value of values) {
  const emitter: any = new EventEmitter();
  const said = new Set<string>();
  for (const method of methods) said.add(attempt(() => emitter[method]("event", value)));
  console.log(typeof value, [...said].join(" | "), emitter.eventNames().length);
  console.log(typeof value, attempt(() => (process.nextTick as any)(value)), "|", attempt(() => (process.nextTick as any)(value, 1, 2)));
}
const log: string[] = [];
class Callable {
  static method(this: unknown, ...given: unknown[]) {
    log.push("static method " + given.join());
  }
}
const functions: Function[] = [
  function plain(...given: unknown[]) { log.push("plain " + given.join()); },
  (...given: unknown[]) => { log.push("arrow " + given.join()); },
  async (...given: unknown[]) => { log.push("async " + given.join()); },
  function* generator() { log.push("never run"); },
  Callable.method,
  function bound(this: { tag: string }, ...given: unknown[]) { log.push(this.tag + " " + given.join()); }.bind({ tag: "bound" }),
  new Proxy(function target(...given: unknown[]) { log.push("proxy " + given.join()); }, {}),
  Math.max,
];
const emitter = new EventEmitter();
emitter.setMaxListeners(100);
for (const listener of functions) {
  emitter.on("event", listener as any);
  emitter.once("event", listener as any);
}
console.log(emitter.listenerCount("event"), emitter.emit("event", 1, 2), emitter.listenerCount("event"), emitter.emit("event", 3), emitter.rawListeners("event").length);
for (const listener of functions) emitter.off("event", listener as any);
console.log(emitter.listenerCount("event"), emitter.emit("event", 4));
for (const callback of functions) process.nextTick(callback as any, "tick");
process.nextTick(() => console.log(log.join("\n")));
