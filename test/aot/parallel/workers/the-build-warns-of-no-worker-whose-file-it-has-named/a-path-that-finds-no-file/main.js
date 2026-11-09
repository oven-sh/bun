// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The path is known and nothing lies there: the warning is all that the build says of it, so it stays.
import { join } from "node:path";
const worker = new Worker(join(import.meta.dir, "..", "no-such-job.js"));
worker.onerror = event => (event.preventDefault(), console.log("error"));
