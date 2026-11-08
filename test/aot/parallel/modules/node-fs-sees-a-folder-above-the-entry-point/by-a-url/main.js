// The folder is made of a URL: `..` takes a folder away there as it does in `path.join`.
// `load` is called where the program is given a name: an export of the entry that nobody can call is dead, and the files that it alone names are not in the executable.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const load = name => require(path.join(import.meta.dir, "../commands", name + ".cjs"));
if (process.argv.length > 2) load(process.argv[2]);
const folder = new URL("../commands/", import.meta.url);
console.log(
  fs.readdirSync(folder).sort().join() +
    " " +
    fs.existsSync(new URL("serve.cjs", folder)) +
    " " +
    fs.statSync(fileURLToPath(folder)).isDirectory(),
);
