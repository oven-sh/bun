// node:events: on, once, off, prepend, the order of listeners, listeners that remove themselves, the error event with and without a listener, newListener, counts and names, once() and on() as promises and iterators, an AbortSignal, captureRejections, a subclass, and EventTarget helpers.
import EventEmitter, { once, on, getEventListeners, errorMonitor, setMaxListeners, EventEmitterAsyncResource } from "node:events";

const log = [];
const emitter = new EventEmitter();
emitter.on("newListener", name => log.push("new " + String(name)));
emitter.on("a", value => log.push("first " + value));
emitter.prependListener("a", value => log.push("prepended " + value));
emitter.once("a", value => log.push("once " + value));
console.log(emitter.emit("a", 1), emitter.emit("a", 2), emitter.emit("nobody"));
console.log(log.join(", "));
console.log(emitter.listenerCount("a"), emitter.eventNames().join(), emitter.listeners("a").length, emitter.rawListeners("a").length);
function removable() { log.push("removable"); }
emitter.on("b", removable).off("b", removable);
emitter.removeAllListeners("a");
console.log(emitter.listenerCount("a"), emitter.listenerCount("b"), emitter.getMaxListeners(), EventEmitter.defaultMaxListeners);

try {
  emitter.emit("error", new RangeError("nobody listens"));
} catch (error) {
  console.log("thrown:", error.message);
}
try {
  emitter.emit("error", "no error object");
} catch (error) {
  console.log(error.code);
}
emitter.on(errorMonitor, error => console.log("monitor:", error.message));
emitter.on("error", error => console.log("handled:", error.message));
emitter.emit("error", new Error("somebody listens"));

setImmediate(() => emitter.emit("later", "x", "y"));
console.log((await once(emitter, "later")).join());
setImmediate(() => emitter.emit("error", new Error("while waiting")));
console.log(await once(emitter, "never").catch(error => "rejected: " + error.message));
const controller = new AbortController();
setImmediate(() => controller.abort());
console.log(await once(emitter, "never", { signal: controller.signal }).catch(error => error.name + " " + error.code));

setImmediate(() => { emitter.emit("tick", 1); emitter.emit("tick", 2); emitter.emit("tick", 3); });
const ticks = [];
for await (const [value] of on(emitter, "tick")) {
  ticks.push(value);
  if (value === 3) break;
}
console.log(ticks.join());

const capturing = new EventEmitter({ captureRejections: true });
const captured = new Promise(resolve => capturing.on("error", error => resolve("captured: " + error.message)));
capturing.on("go", async () => { throw new Error("from an async listener"); });
capturing.emit("go");
console.log(await captured);

class Door extends EventEmitter { open() { return this.emit("open", this); } }
const door = new Door();
door.on("open", function (self) { console.log(this === door, self === door, this instanceof EventEmitter); });
door.open();
const target = new EventTarget();
target.addEventListener("x", () => {});
setMaxListeners(5, target, door);
console.log(getEventListeners(target, "x").length, getEventListeners(door, "open").length, door.getMaxListeners(), typeof EventEmitterAsyncResource);
