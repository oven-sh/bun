// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// A call of import.meta.resolveSync() stores nothing on import.meta: the URL beside it still names the file, and the load has followed it.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const own = import.meta.resolveSync("./main.js");
const worker = new Worker(new URL("../job.js", import.meta.url));
worker.onmessage = event => (console.log(event.data, own.endsWith("main.js")), worker.terminate());
