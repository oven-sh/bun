// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { EventEmitter } from "node:events";
process.env._events = "a";
console.log(EventEmitter.prototype.rawListeners.call(process.env, "localeCompare")[0].call("a", "b", "de"));
