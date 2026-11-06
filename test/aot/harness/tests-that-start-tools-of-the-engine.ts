// `jsc`, `testaot` and the folder `aot-tests` are packed beside Bun and are as large as Bun. scripts/runner.node.ts leaves them packed
// in a shard that has no test that starts them. A test starts them if it imports ../shell/find-tools.ts, which looks for them, itself
// or through other files of this folder. So nobody keeps a list. Node runs this file.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const folderOfTests = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fileThatFindsTools = join(folderOfTests, "shell", "find-tools.ts");
const writtenPath = /(?:\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*["'](\.\.?\/[^"']+)["']/g;
const endings = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"];
const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

const importedBy = new Map<string, string[]>();
function filesImportedBy(file: string) {
  let imported = importedBy.get(file);
  if (!imported) {
    imported = Array.from(readFileSync(file, "utf8").matchAll(writtenPath), ([, written]) =>
      endings.map(ending => resolve(dirname(file), written!) + ending).find(isFile),
    ).filter(path => path !== undefined && path.startsWith(folderOfTests + sep)) as string[];
    importedBy.set(file, imported);
  }
  return imported;
}

/** `testPath`: below `test`, as the runner names it. */
export function startsToolsOfTheEngine(testPath: string) {
  const first = resolve(folderOfTests, "..", testPath);
  if (!first.startsWith(folderOfTests + sep)) return false;
  const seen = new Set([first]);
  for (const file of seen) {
    if (file === fileThatFindsTools) return true;
    for (const imported of filesImportedBy(file)) seen.add(imported);
  }
  return false;
}
