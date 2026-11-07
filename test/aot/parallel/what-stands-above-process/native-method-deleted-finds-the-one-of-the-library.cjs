// The native listener methods lie in front of those of node:events. Where a program deletes them, the ones of the library are found and get `process` as `this`.
const EventEmitter = require("node:events");
const native = Object.getPrototypeOf(process);
delete native.listenerCount;
delete native.on;
delete native.emit;
console.log(process.on === EventEmitter.prototype.on, process.listenerCount === EventEmitter.prototype.listenerCount);
let heard = 0;
process.on("madeUp", amount => { heard += amount; });
console.log(process.listenerCount("madeUp"), process.emit("madeUp", 3), heard, typeof process._events, process._eventsCount);
