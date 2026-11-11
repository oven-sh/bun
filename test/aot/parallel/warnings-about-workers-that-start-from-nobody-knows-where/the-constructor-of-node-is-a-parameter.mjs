// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
import { Worker } from "node:worker_threads";
const start = Thread => new Thread(process.argv[5], { eval: true });
if (process.argv.length > 5) start(Worker);
console.log("none started");
