// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The engine listed the first nameless start alone: with that one struck, the second would have gone unseen.
import { join } from "node:path";
const worker = new Worker(join(import.meta.dir, "..", "job.js"));
worker.onmessage = event => (console.log(event.data), worker.terminate());
if (process.argv.length > 9) new Worker(process.argv[9]);
