// `import.meta.dir` is /$bunfs/root in an executable, and the path that is joined is /$bunfs/plugins/first.js.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "node:path";
const name = process.argv.length > 9 ? process.argv[9] : "first";
console.log((await import(path.join(import.meta.dir, "..", "plugins", name + ".js"))).said);
