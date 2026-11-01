// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.on("constructor", value => console.log("heard", value));
console.log(emitter.emit("constructor", 1), emitter.emit("toString"), emitter.listenerCount("__proto__"));
