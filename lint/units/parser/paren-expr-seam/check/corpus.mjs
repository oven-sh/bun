// usage: bun corpus.mjs <out.json>    the .ts and .tsx files of src/js, of bench/snippets and a slice of test/ (sorted, at most 1200)
import { Glob } from "bun";
import { writeFileSync } from "node:fs";
const root = "/workspace/wt/parser/";
const list = [];
for (const [dir, pattern, max] of [["src/js", "**/*.ts", 1e9], ["bench/snippets", "*.tsx", 1e9], ["test/js", "**/*.{ts,tsx}", 900], ["test/bundler", "**/*.{ts,tsx}", 200], ["test/cli", "**/*.{ts,tsx}", 100]]) {
  const paths = [...new Glob(pattern).scanSync({ cwd: root + dir })].filter(p => !p.includes("node_modules/") && !p.endsWith(".d.ts")).sort().slice(0, max);
  for (const p of paths) list.push(dir + "/" + p);
}
writeFileSync(process.argv[2], JSON.stringify(list));
console.log(list.length, "files");
