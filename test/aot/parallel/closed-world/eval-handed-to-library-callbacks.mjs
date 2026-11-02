// eval is a listener of an EventEmitter and the callback of process.nextTick.
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.on("text", eval);
emitter.emit("text", process.argv.length > 99 ? "0" : "globalThis.heard = true");
console.log(globalThis.heard);
process.nextTick(eval, process.argv.length > 99 ? "0" : "globalThis.ticked = true");
setTimeout(() => console.log(globalThis.ticked), 1);
