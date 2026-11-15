// The code of the Worker starts another, and names it by the path of the file that holds the code, which lies above the entry point. Nothing else names lib/posts.mjs.
// The build read what such code imports by the depth of the executable's folders, and the names of its Workers by none: the file was not compiled, and the inner Worker did not load.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { start } from "../lib/names-a-worker.mjs";
console.log(await start());
