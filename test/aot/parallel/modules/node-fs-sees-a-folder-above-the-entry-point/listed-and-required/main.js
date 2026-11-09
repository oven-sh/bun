// The loader of the page (docs/compiler/compatibility.mdx) that lists a folder, where the folder lies beside that of the entry point.
// In an executable the folder is /$bunfs/commands, which is /$bunfs/_.._/_.._/commands to the loader and was nothing to node:fs: ENOENT: scandir '/$bunfs/commands'.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "../commands");
for (const file of fs.readdirSync(folder).sort()) console.log(file + ": " + require(path.join(folder, file)).said);
