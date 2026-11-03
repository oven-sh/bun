// node:events asks for the prototype of `process` at its top level and only looks at it. That brings in nothing that `process` can do.
// STATISTIC: FunctionsLowered <= 800
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.once("greeting", name => console.log("hello", name));
console.log(emitter.emit("greeting", "you"), emitter.emit("greeting", "nobody"), process instanceof EventEmitter);
