// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The load has followed the path to the file, and the Worker starts. The engine says that a start stands at the last name of its callee, and the load looked for it at the first.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { join } from "node:path";
const worker = new globalThis.Worker(join(import.meta.dir, "..", "job.js"));
worker.onmessage = event => (console.log(event.data), worker.terminate());
