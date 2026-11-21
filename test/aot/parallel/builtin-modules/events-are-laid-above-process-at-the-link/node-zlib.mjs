// node:zlib loads node:events at the link, which lays EventEmitter.prototype above the prototype of process: an import that nothing reads shows it.
import zlib from "node:zlib";
const above = Object.getPrototypeOf(Object.getPrototypeOf(process));
console.log(above === Object.prototype, Object.getPrototypeOf(above) === Object.prototype);
console.log(
  typeof process.eventNames,
  typeof process.rawListeners,
  typeof process.prependOnceListener,
  typeof process.getMaxListeners,
  typeof process.listenerCount,
);
console.log(process.eventNames().length, process.listenerCount("exit"), process.getMaxListeners());
console.log(Object.getOwnPropertyNames(above).sort().join(" "));
