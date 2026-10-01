import { readFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const t = new Bun.Transpiler({ loader: "ts" });
function bun(src) { try { t.transformSync(src); return "ok"; } catch (e) { const l = e?.errors?.length ? e.errors : [e]; return l.map(x => `${x.message}${x.position ? " @" + x.position.line + ":" + x.position.column + " " + JSON.stringify((x.position.lineText || "").slice(0, 100)) : ""}`).slice(0, 2).join(" | "); } }
const roots = process.argv.slice(2); const listFile = roots[0] === "--list" ? roots[1] : null;
let files = [];
if (listFile) files = readFileSync(listFile, "utf8").split("\n").filter(Boolean); else for (const r of roots) for (const f of new Bun.Glob("**/*.d.{ts,mts,cts}").scanSync({ cwd: r, absolute: true, followSymlinks: false })) files.push(f);
files.sort();
let total = 0, tscParseOk = 0, plainOk = 0, wrappedOk = 0;
const causes = new Map();
for (const f of files) {
  let src; try { src = readFileSync(f, "utf8"); } catch { continue; }
  total++;
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.ESNext, false);
  if (sf.parseDiagnostics.length) continue;
  tscParseOk++;
  const plain = bun(src);
  if (plain === "ok") plainOk++;
  const wrapped = bun(`declare module "m" {\n${src}\n}`);
  if (wrapped === "ok") wrappedOk++;
  else {
    const key = wrapped.replace(/@\d+:\d+.*/, "").replace(/"[^"]*"/g, '"…"').trim();
    if (!causes.has(key)) causes.set(key, []);
    causes.get(key).push(f + "  ::  " + wrapped.slice(0, 230));
  }
}
console.log({ roots, total, tscParseOk, plainOk, wrappedOk });
for (const [k, v] of [...causes].sort((a, b) => b[1].length - a[1].length)) { console.log(`\n[${v.length}] ${k}`); for (const x of v.slice(0, 4)) console.log("    " + x); }
