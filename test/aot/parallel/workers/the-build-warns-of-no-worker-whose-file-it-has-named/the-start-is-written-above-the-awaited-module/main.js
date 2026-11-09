// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The start stands above the load in the text. The path is written from the folder of the file, which names the file by itself, and the Worker starts.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { join } from "node:path";
const start = () => new Thread(join(import.meta.dir, "..", "job.js"));
const { Worker: Thread } = await import("node:worker_threads");
const worker = start();
worker.on("message", said => (console.log(said), worker.terminate()));
