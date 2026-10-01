import { Glob } from "bun";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = "/workspace/wt/parser";
const files = [];
const glob = new Glob("**/*.{js,jsx,mjs,cjs}");
for (const top of ["test", "src/js"]) {
  for (const entry of readdirSync(join(root, top), { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    if (!entry.isDirectory()) { if (/\.(js|jsx|mjs|cjs)$/.test(entry.name)) files.push(`${top}/${entry.name}`); continue; }
    for (const file of glob.scanSync({ cwd: join(root, top, entry.name) })) { const path = `${top}/${entry.name}/${file}`; if (!path.includes("/node_modules/")) files.push(path); }
  }
}
files.sort();
let bytes = 0; for (const f of files) bytes += statSync(join(root, f)).size;
writeFileSync("js.files.txt", files.join("\n") + "\n");
writeFileSync("js.list.json", JSON.stringify({ root, files: files.map((f, i) => [i, f]) }));
console.log(files.length, bytes);
