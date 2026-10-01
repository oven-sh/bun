// Transforms every TypeScript file under the given directories with the running bun and writes one line per file:
// the hash of the output, or the first error. Two runs (base build, changed build) are compared with `diff`.
// usage: <bun> regress.mjs <out.jsonl> <dir>...
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
const [out, ...dirs] = process.argv.slice(2);
function* walk(dir) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  ents.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") yield* walk(p); }
    else if (/\.[mc]?tsx?$/.test(e.name)) yield p;
  }
}
const lines = [];
let n = 0;
for (const dir of dirs) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf8");
    if (text.length > 400_000) continue;
    const loader = file.endsWith("x") ? "tsx" : "ts";
    const rec = { file };
    for (const [key, tsconfig] of [["plain", {}], ["meta", { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }]]) {
      const t = new Bun.Transpiler({ loader, target: "bun", tsconfig, trimUnusedImports: true });
      try { rec[key] = Bun.hash(t.transformSync(text)).toString(16); }
      catch (e) { rec[key] = "ERR " + (e?.errors ?? [e]).map(x => String(x?.message ?? x).split("\n")[0]).join(" | ").slice(0, 300); }
    }
    try { rec.scan = new Bun.Transpiler({ loader, target: "bun" }).scanImports(text).map(i => i.kind + ":" + i.path).join(","); }
    catch (e) { rec.scan = "ERR"; }
    lines.push(JSON.stringify(rec));
    n++;
  }
}
writeFileSync(out, lines.join("\n") + "\n");
console.log(n, "files");
