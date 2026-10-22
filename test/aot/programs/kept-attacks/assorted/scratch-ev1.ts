// Assorted, one probe of many. It prints what plain Bun prints.
import { once, EventEmitter } from "node:events";
const emitter = new EventEmitter();
const waiting = once(emitter, "x");
emitter.emit("x", 1);
console.log((await waiting).length);
