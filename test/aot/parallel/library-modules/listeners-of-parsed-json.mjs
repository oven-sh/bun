// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { EventEmitter } from "node:events";
console.log(
  EventEmitter.prototype.rawListeners.call(JSON.parse('{"_events":5}'), "toLocaleString")[0].call(12345.678, "de-DE"),
);
