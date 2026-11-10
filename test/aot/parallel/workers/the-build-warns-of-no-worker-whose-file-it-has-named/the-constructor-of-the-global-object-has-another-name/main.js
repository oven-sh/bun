// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The program takes the constructor off the global object under a name of its own. The path is written from the folder of the file, which names the
// file by itself, and the Worker starts. The build warned here and left the file out.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { join } from "node:path";
const { Worker: Thread } = globalThis;
const worker = new Thread(join(import.meta.dir, "..", "job.js"));
worker.onmessage = event => (console.log(event.data), worker.terminate());
