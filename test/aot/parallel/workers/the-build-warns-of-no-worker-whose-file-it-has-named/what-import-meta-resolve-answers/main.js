// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The load has followed the path to the file, and the Worker starts. The engine reads a file off a text or a URL object alone and called this start nameless.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const worker = new Worker(import.meta.resolve("../job.js"));
worker.onmessage = event => (console.log(event.data), worker.terminate());
