// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The load has followed the path to the files that fit, and the Worker starts.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { join } from "node:path";
const worker = new Worker(
  join(import.meta.dir, "../jobs", (process.argv.length > 9 ? process.argv[9] : "first") + ".js"),
);
worker.onmessage = event => (console.log(event.data), worker.terminate());
