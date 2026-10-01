// Probe: which properties TypeScript 6.0.2 nodes carry in the corpus, by kind.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
const dirs = ["/tmp/tsimp/corpus", "/workspace/ref/typescript-go/internal/bundled/libs"];
const scal = new Map<string, number>(), child = new Map<string, number>();
const TYPES = ["bool", "kind", "string", "int"];
for (const dir of dirs) for (const f of fs.readdirSync(dir).sort()) {
  if (!/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f)) continue;
  const b = dumpFiles([{ name: "/" + f, text: fs.readFileSync(path.join(dir, f), "utf8") }]);
  const d = b.files[0];
  const kindOf = (i: number) => b.kinds[d.nodes[i * 8]];
  for (let i = 0; i < d.attrs.length; i += 4) { const k = `${b.props[d.attrs[i + 1]]}:${TYPES[d.attrs[i + 2]]}\t${kindOf(d.attrs[i])}`; scal.set(k, (scal.get(k) ?? 0) + 1); }
  const listSeen = new Set<number>();
  for (let i = 1; i < d.nodes.length / 8; i++) {
    const o = i * 8, parent = d.nodes[o + 4], prop = b.props[d.nodes[o + 5]], list = d.nodes[o + 6];
    if (list >= 0) { if (listSeen.has(list)) continue; listSeen.add(list); }
    const k = `${prop}:${list >= 0 ? "list" : "node"}\t${kindOf(parent)}`;
    child.set(k, (child.get(k) ?? 0) + 1);
  }
}
function group(m: Map<string, number>) {
  const by = new Map<string, string[]>();
  for (const [k] of m) { const [p, kind] = k.split("\t"); if (!by.has(p)) by.set(p, []); by.get(p)!.push(kind); }
  return [...by].sort().map(([p, ks]) => `${p}  <- ${ks.sort().join(", ")}`).join("\n");
}
fs.writeFileSync("/tmp/tsimp/final/census.txt", "# scalar properties\n" + group(scal) + "\n# child properties\n" + group(child) + "\n");
console.log("written");
