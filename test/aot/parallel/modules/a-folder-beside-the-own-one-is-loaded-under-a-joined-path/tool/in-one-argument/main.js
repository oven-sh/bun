// The `..` and the name in part stand in one argument: the build knew the files, and the run found no case for /$bunfs/plugins/second.js.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "node:path";
const name = process.argv.length > 9 ? process.argv[9] : "second";
console.log((await import(path.join(import.meta.dir, "../plugins/" + name + ".js"))).said);
