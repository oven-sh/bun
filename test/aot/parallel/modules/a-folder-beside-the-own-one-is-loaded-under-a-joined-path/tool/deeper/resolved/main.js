// Two folders up, by `path.resolve`: below /$bunfs/root that is /plugins/first.js.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "node:path";
const name = process.argv.length > 9 ? process.argv[9] : "first";
console.log((await import(path.resolve(import.meta.dir, "../../plugins", name + ".js"))).said);
