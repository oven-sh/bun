// usage: <bun> corpus.mjs <out.jsonl> <dir>...   one line per .ts/.tsx/.mts/.cts file: path, hash of the output or the first error
import { Glob } from "bun";
import { writeFileSync, readFileSync } from "node:fs";
const out = process.argv[2];
const lines = [];
const tr = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) };
for (const dir of process.argv.slice(3)) {
  const files = [...new Glob("**/*.{ts,tsx,mts,cts}").scanSync({ cwd: dir, onlyFiles: true })].filter(f => !f.includes("node_modules/")).sort();
  for (const f of files) {
    let src;
    try { src = readFileSync(dir + "/" + f, "utf8"); } catch { continue; }
    if (src.length > 2_000_000) continue;
    const loader = f.endsWith("x") ? "tsx" : "ts";
    let res;
    try { res = "ok " + Bun.hash(tr[loader].transformSync(src)).toString(16); } catch (e) { res = "err " + String(e?.errors?.[0]?.message ?? e?.message ?? e).split("\n")[0]; }
    lines.push(JSON.stringify([dir + "/" + f, res]));
  }
}
writeFileSync(out, lines.join("\n") + "\n");
console.log(lines.length, "files");
