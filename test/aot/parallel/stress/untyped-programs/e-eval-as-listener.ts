// Untyped programs: e eval as listener. It prints what plain Bun prints.
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.on("text", eval);
emitter.emit("text", process.argv.length > 99 ? "0" : "globalThis.ranTheString = true");
console.log((globalThis as any).ranTheString);
