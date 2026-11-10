const EventEmitter = require("node:events");
const native = Object.getPrototypeOf(process);
console.log(process instanceof EventEmitter, Object.getPrototypeOf(native) === EventEmitter.prototype);
EventEmitter.prototype.madeUp = function () { return "laid on the library's"; };
console.log(process.madeUp());
process.once("made-up", value => console.log("once", value));
console.log(process.emit("made-up", 1), process.emit("made-up", 2));
