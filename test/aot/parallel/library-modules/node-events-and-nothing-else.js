// node:events lays its EventEmitter.prototype above the native prototype of `process` by a native function that is not handed `process`. That brings in nothing that `process` can do.
// STATISTIC: FunctionsLowered <= 800
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.once("greeting", name => console.log("hello", name));
console.log(emitter.emit("greeting", "you"), emitter.emit("greeting", "nobody"), process instanceof EventEmitter);
