// The code of the Worker is put together twice: what it imports lies higher than every file found before, so the folders of the executable go one deeper than the first text says.
// The text of the first time goes out of the program. While it stayed, the name of the Worker in it, spelled for the depth of that time, named a file that is not there, and the build warned of a Worker that would not load.
// Build prints: 0 x warn: TS100081: This Worker may start from a file that isn't compiled, and then it fails to load: /$bunfs/_.._/_.._/lib/posts.mjs. Add the file as an entry point, or write its path as new URL("./file", import.meta.url)
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { start } from "../lib/names-a-worker.mjs";
console.log(await start());
