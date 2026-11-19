// The code of the Worker holds the URL of lib/names-a-worker.mjs, a file above the entry point, and names by it the Worker that it starts and a file one folder higher than every other, which nothing else leads to.
// How that URL reads hangs on the highest file, so the build follows the code first and puts it together for the depth that it finds. It stopped at the higher file: TS100087.
// The URL, not the path of the folder: on Windows a path holds backslashes, and between the quotes of the code they are escapes.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { start } from "../lib/names-a-worker.mjs";
console.log(await start());
