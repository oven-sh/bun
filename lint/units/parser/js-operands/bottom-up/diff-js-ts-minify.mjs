// usage: <bun> diff-js-ts.mjs <out.jsonl> <root> [<root> ...] [--node-modules]
// For every .js/.mjs/.cjs/.jsx file: transpile with loader js vs ts and jsx vs tsx, same options, and compare.
import { Glob } from "bun";
import { readFileSync, writeFileSync, appendFileSync, statSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
const outPath = args.shift();
const withNodeModules = args.includes("--node-modules");
const roots = args.filter(a => !a.startsWith("--"));
const opts = loader => ({ loader, trimUnusedImports: false, target: "bun", deadCodeElimination: false, inline: false, minify: { identifiers: true, syntax: false, whitespace: false } });
const T = { js: new Bun.Transpiler(opts("js")), jsx: new Bun.Transpiler(opts("jsx")), ts: new Bun.Transpiler(opts("ts")), tsx: new Bun.Transpiler(opts("tsx")) };

function run(loader, code) {
  try {
    return { ok: true, out: T[loader].transformSync(code).replace(/"input\.[jt]sx?"/g, "\"input.X\"") };
  } catch (e) {
    const errs = (e?.errors ?? [e]).map(x => `${x?.position?.line ?? "?"}:${x?.position?.column ?? "?"} ${x?.message ?? String(x)}`);
    return { ok: false, errs };
  }
}
function firstDiff(a, b) {
  const la = a.split("\n"), lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) return { line: i + 1, a: (la[i] ?? "<eof>").slice(0, 300), b: (lb[i] ?? "<eof>").slice(0, 300) };
  return null;
}
writeFileSync(outPath, "");
const counts = {};
const bump = k => (counts[k] = (counts[k] ?? 0) + 1);
let files = 0;
for (const root of roots) {
  for (const ext of ["js", "mjs", "cjs", "jsx"]) {
    for (const rel of new Glob(`**/*.${ext}`).scanSync({ cwd: root, dot: true, followSymlinks: false })) {
      const inNm = rel.includes("node_modules/");
      if (inNm !== withNodeModules) continue;
      const path = join(root, rel);
      let code;
      try {
        if (statSync(path).size > 4_000_000) { bump("skipped-large"); continue; }
        code = readFileSync(path, "utf8");
      } catch { bump("unreadable"); continue; }
      files++;
      for (const [j, t] of [["js", "ts"], ["jsx", "tsx"], ["js", "jsx"]]) {
        const a = run(j, code), b = run(t, code);
        let cls, detail;
        if (a.ok && b.ok) {
          if (a.out === b.out) cls = "same";
          else { cls = "out-diff"; detail = firstDiff(a.out, b.out); }
        } else if (a.ok && !b.ok) { cls = "ts-rejects"; detail = b.errs.slice(0, 3); }
        else if (!a.ok && b.ok) { cls = "js-rejects-ts-accepts"; detail = a.errs.slice(0, 3); }
        else { cls = JSON.stringify(a.errs) === JSON.stringify(b.errs) ? "both-reject-same" : "both-reject-differently"; detail = { js: a.errs.slice(0, 2), ts: b.errs.slice(0, 2) }; }
        bump(`${j}/${t} ${cls}`);
        if (cls !== "same" && cls !== "both-reject-same") appendFileSync(outPath, JSON.stringify({ path, pair: `${j}/${t}`, cls, detail }) + "\n");
      }
    }
  }
}
console.log(JSON.stringify({ files, counts }, null, 1));
