// Built ins found by binding: programs events later. It prints what plain Bun prints.
const native = Object.getPrototypeOf(process);
console.log(Object.getPrototypeOf(native) === Object.prototype, process._eventsCount, process.domain);
const EventEmitter = require("node:events");
console.log(Object.getPrototypeOf(native) === EventEmitter.prototype, process._eventsCount, process instanceof EventEmitter);
console.log(process.on === native.on, process.on !== EventEmitter.prototype.on);
process.on("exit", code => console.log("exit", code));
