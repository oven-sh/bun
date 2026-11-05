// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { EventEmitter } from "node:events";
try {
  console.log(EventEmitter.prototype.emit.call({ _events: new Date(0) }, "toLocaleString"));
} catch (error) {
  console.log(error.name);
}
