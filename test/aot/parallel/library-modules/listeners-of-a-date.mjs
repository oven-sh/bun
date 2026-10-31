// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { EventEmitter } from "node:events";
const method = EventEmitter.prototype.rawListeners.call({ _events: new Date(0) }, "toLocaleDateString")[0];
console.log(method.call(new Date(0), "en-US", { timeZone: "UTC" }));
