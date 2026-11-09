// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The program keeps the constructor under a name of its own. The load has followed the path to the file all the same, and the Worker starts.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { join } from "node:path";
const { Worker: Thread } = await import("node:worker_threads");
const worker = new Thread(join(import.meta.dir, "..", "job.js"));
worker.on("message", said => (console.log(said), worker.terminate()));
