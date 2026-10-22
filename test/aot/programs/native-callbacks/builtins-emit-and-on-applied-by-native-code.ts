// Built-ins applied by native code: emit, on and once of an emitter are bound and handed to timers, ticks, promises, forEach and another emitter, so a listener typed for a number gets what those callers pass.
import { EventEmitter } from "node:events";

let total = 0;

function onValue(value: number, extra: number): void {
  total += typeof value === "number" ? 1 : typeof value === "string" ? 100 : value === undefined ? 10000 : 1000000;
  total += typeof extra === "number" ? 100000000 : 0;
}

onValue(1, undefined as any);
const emitter = new EventEmitter();
emitter.on("value", onValue);
const emit = emitter.emit.bind(emitter, "value");
setTimeout(emit, 1, "text");
setTimeout(emit, 1);
process.nextTick(emit, {});
queueMicrotask(emit as () => void);
["a"].forEach(emit);
await Promise.resolve("resolved").then(emit);
const relay = new EventEmitter();
relay.on("value", emit);
relay.emit("value", 5);
Reflect.apply(emitter.emit, emitter, ["value", null]);
EventEmitter.prototype.emit.call(emitter, "value", 6n);
["value"].forEach(emitter.emit, emitter);
setTimeout(() => console.log(total), 10);
