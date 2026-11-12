// A proxy that a program has laid above `process` before node:events is loaded is asked what stands above it and is then told to stand below EventEmitter.prototype, in that order.
const native = Object.getPrototypeOf(process);
const asked = [];
const proxy = new Proxy(Object.create(native), {
  getPrototypeOf(target) { asked.push("getPrototypeOf"); return Reflect.getPrototypeOf(target); },
  setPrototypeOf(target, above) { asked.push("setPrototypeOf " + typeof above.listenerCount); return Reflect.setPrototypeOf(target, above); },
  get(target, key, receiver) { if (typeof key === "string" && key.startsWith("madeUp")) asked.push("get " + key); return Reflect.get(target, key, receiver); },
});
Object.setPrototypeOf(process, proxy);
const EventEmitter = require("node:events");
const count = asked.length;
console.log(asked.slice(0, count).join(", "));
console.log(Object.getPrototypeOf(process) === proxy, Object.getPrototypeOf(native) === Object.prototype);
