// statSync, lstatSync, accessSync, a listing with types, opendirSync and the promises, of the folder beside that of the entry point and of a file in it.
// `load` is called where the program is given a name: an export of the entry that nobody can call is dead, and the files that it alone names are not in the executable.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "../commands");
export const load = name => require(path.join(folder, name + ".cjs"));
if (process.argv.length > 2) load(process.argv[2]);
const file = path.join(folder, "build.cjs");
console.log(
  "stat: " +
    [
      fs.statSync(folder).isDirectory(),
      fs.statSync(file).isFile(),
      fs.lstatSync(file).isFile(),
      fs.accessSync(file) ?? "ok",
    ].join(),
);
console.log(
  "types: " +
    fs
      .readdirSync(folder, { withFileTypes: true })
      .map(it => it.name + (it.isFile() ? " is a file" : " is something else"))
      .sort()
      .join(", "),
);
const open = fs.opendirSync(folder);
const names = [];
for (let entry; (entry = open.readSync()); ) names.push(entry.name);
open.closeSync();
console.log("opendir: " + names.sort().join());
console.log(
  "promises: " + [(await fs.promises.readdir(folder)).sort().join(), (await fs.promises.stat(file)).isFile()].join(" "),
);
console.log(
  "what is not there: " +
    [fs.existsSync(path.join(folder, "deploy.cjs")), fs.existsSync(path.join(folder, "../nothing"))].join(),
);
