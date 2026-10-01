// The same three runs (as is, II, I) over real declaration files: TypeScript's lib files and node_modules.
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const roots = process.argv.slice(2);
function* walk(d, depth = 0) { let es; try { es = readdirSync(d); } catch { return; } for (const e of es) { const p = join(d, e); let s; try { s = lstatSync(p); } catch { continue; } if (s.isSymbolicLink()) continue; if (s.isDirectory()) { if (depth < 12) yield* walk(p, depth + 1); } else yield p; } }
const isDts = n => /\.d\.(ts|mts|cts)$/.test(n);
const t = new Bun.Transpiler({ loader: "ts" });
const SK = ts.SyntaxKind;
function constToLet(sf, src) {
  const edits = [];
  (function visit(n) {
    if (ts.isVariableDeclarationList(n) && (n.flags & ts.NodeFlags.Const) && n.declarations.some(d => !d.initializer)) {
      const start = n.getStart(sf);
      if (src.startsWith("const", start)) edits.push([start, 5, "let  "]);
    }
    ts.forEachChild(n, visit);
  })(sf);
  let out = src;
  for (const [s, l, r] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + r + out.slice(s + l);
  return out;
}
function addDeclare(sf, src) {
  const edits = [];
  for (const st of sf.statements) {
    const k = st.kind;
    if (![SK.VariableStatement, SK.FunctionDeclaration, SK.ClassDeclaration, SK.EnumDeclaration, SK.ModuleDeclaration].includes(k)) continue;
    const mods = st.modifiers ?? [];
    if (mods.some(m => m.kind === SK.DeclareKeyword)) continue;
    if (mods.some(m => m.kind === SK.DefaultKeyword)) continue;
    const exp = mods.find(m => m.kind === SK.ExportKeyword);
    const at = exp ? exp.end : st.getStart(sf);
    edits.push([at, exp ? " declare" : "declare "]);
  }
  let out = src;
  for (const [s, r] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + r + out.slice(s);
  return out;
}
const res = { asis: new Map(), II: new Map(), I: new Map() };
let n = 0, tscBad = 0, bytes = 0;
for (const root of roots) for (const file of walk(root)) {
  if (!isDts(file)) continue;
  let src; try { src = readFileSync(file, "utf8"); } catch { continue; }
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  if (src.length > 3_000_000) continue;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length) { tscBad++; continue; }
  n++; bytes += src.length;
  for (const [name, fn] of [["asis", (_, s) => s], ["II", constToLet], ["I", addDeclare]]) {
    const input = fn(sf, src);
    let err = null;
    try { t.transformSync(input); } catch (e) { const list = e?.errors?.length ? e.errors : [e]; err = list[0]; }
    if (err === null) continue;
    const key = String(err.message).replace(/"[^"]*"/g, '"…"');
    if (!res[name].has(key)) res[name].set(key, []);
    res[name].get(key).push(file + ":" + (err.position?.line ?? "?") + " :: " + (err.position?.lineText ?? "").trim().slice(0, 120));
  }
}
console.log("declaration files that tsc parses:", n, "bytes:", bytes, "tsc parse errors:", tscBad);
for (const name of ["asis", "II", "I"]) {
  console.log("== run", name, "failing:", [...res[name].values()].reduce((a, b) => a + b.length, 0));
  for (const [k, v] of [...res[name]].sort((a, b) => b[1].length - a[1].length)) {
    console.log(String(v.length).padStart(5), k);
    for (const f of v.slice(0, 5)) console.log("        " + f);
  }
}
