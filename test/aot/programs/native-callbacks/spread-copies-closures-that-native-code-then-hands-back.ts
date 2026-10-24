// Sources of a spread: a closure that lies in an object which is only ever spread reaches an emitter, a Map, a WeakRef, a promise and a timer inside the copy, comes back as `any`, and is called with a string; direct calls pass numbers.
import { EventEmitter } from "node:events";

let total = 0;

const context = {
  scale: 2,
  handler(value: number): void {
    total += typeof value === "number" ? value * this.scale : typeof value === "string" ? 1000 : 1000000;
  },
  arrow: (value: number): void => {
    total += typeof value === "number" ? value : typeof value === "string" ? 100000 : 1000000;
  },
};

context.handler(1);
context.arrow(1);
const use = (copy: any): void => {
  copy.handler("text");
  copy.arrow("text");
};
const emitter = new EventEmitter();
emitter.on("context", use);
emitter.emit("context", { ...context });
use(new Map<string, unknown>([["c", { ...context }]]).get("c"));
use(new WeakRef({ ...context }).deref());
use(Object.values({ inner: { ...context } })[0]);
use([{ ...context }].concat([])[0]);
await Promise.resolve({ ...context }).then(use);
await new Promise<void>(resolve => setTimeout(copy => (use(copy), resolve()), 1, { ...context }));
console.log(total);
