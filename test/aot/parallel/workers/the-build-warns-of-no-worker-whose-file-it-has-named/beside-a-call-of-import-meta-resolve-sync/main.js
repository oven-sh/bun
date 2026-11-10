// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// A call of import.meta.resolveSync() stores nothing on import.meta: the URL and the path beside it still name the file, and the load has followed both.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { join } from "node:path";
const own = import.meta.resolveSync("./main.js");
const answerOf = worker =>
  new Promise(resolve => {
    worker.onmessage = event => (worker.terminate(), resolve(event.data));
    worker.onerror = event => (event.preventDefault(), resolve("error"));
  });
console.log(await answerOf(new Worker(new URL("../job.js", import.meta.url))), own.endsWith("main.js"));
console.log(await answerOf(new Worker(join(import.meta.dir, "..", "job.js"))));
