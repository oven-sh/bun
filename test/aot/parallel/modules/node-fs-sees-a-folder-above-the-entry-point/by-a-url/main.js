// The folder is made of a URL: `..` takes a folder away there as it does in `path.join`.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const load = name => require(path.join(import.meta.dir, "../commands", name + ".cjs"));
const folder = new URL("../commands/", import.meta.url);
console.log(
  fs.readdirSync(folder).sort().join() +
    " " +
    fs.existsSync(new URL("serve.cjs", folder)) +
    " " +
    fs.statSync(fileURLToPath(folder)).isDirectory(),
);
