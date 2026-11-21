// node:path loads nothing that touches process: with an import of it that nothing reads, Object.prototype still lies right above the prototype of process.
import path from "node:path";
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
