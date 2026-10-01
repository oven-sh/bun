import { readFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const t = new Bun.Transpiler({ loader: "ts" });
function bun(src) { try { t.transformSync(src); return null; } catch (e) { const l = e?.errors?.length ? e.errors : [e]; return l.map(x => ({ m: x.message, line: x.position?.lineText?.trim().slice(0, 90) })); } }
const files = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const causes = new Map();
for (const f of files) {
  let src; try { src = readFileSync(f, "utf8"); } catch { continue; }
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.ESNext, false);
  if (sf.parseDiagnostics.length) continue;
  const errs = bun(src);
  if (!errs) continue;
  const first = errs[0];
  const key = first.m.replace(/"[^"]*"/g, '"…"');
  if (!causes.has(key)) causes.set(key, { n: 0, ex: [] });
  const c = causes.get(key); c.n++; if (c.ex.length < 3) c.ex.push(first.line + "   <" + f.split("node_modules/").pop() + ">");
}
for (const [k, v] of [...causes].sort((a, b) => b[1].n - a[1].n)) { console.log(`[${v.n}] ${k}`); for (const x of v.ex) console.log("      " + x); }
