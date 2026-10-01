// Simulates two ambient designs on the declaration-file units of the corpus with the installed parser.
// II: only the initializer rule is lifted (const -> let, same offsets). I: every top-level declaration gets "declare".
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
function* walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); if (s.isDirectory()) yield* walk(p); else yield p; } }
const isDts = n => /\.d\.(ts|mts|cts)$/.test(n) || (/\.ts$/.test(n) && /\.d\./.test(n.split("/").pop()));
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
const res = { II: new Map(), I: new Map() };
let n = 0;
for (const dir of ["conformance", "compiler"]) {
  for (const file of walk(join(root, dir))) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    let text; try { text = readFileSync(file, "utf8"); } catch { continue; }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const lines = text.split(/\r?\n/);
    const parts = []; let cur = { name: file.split("/").pop(), lines: [] }; let sawFilename = false;
    for (const line of lines) {
      const m = /^\/\/\s*@filename\s*:\s*(\S+)/i.exec(line);
      if (m) { if (sawFilename || cur.lines.some(l => l.trim().length && !/^\/\/\s*@\w+\s*:/.test(l))) parts.push(cur); cur = { name: m[1], lines: [] }; sawFilename = true; continue; }
      if (/^\/\/\s*@\w+\s*:/.test(line)) continue;
      cur.lines.push(line);
    }
    parts.push(cur);
    for (const part of parts) {
      if (!isDts(part.name)) continue;
      const src = part.lines.join("\n");
      const sf = ts.createSourceFile("/" + part.name.replace(/^.*\//, ""), src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
      if (sf.parseDiagnostics.length) continue;
      n++;
      for (const [name, fn] of [["II", constToLet], ["I", addDeclare]]) {
        const input = fn(sf, src);
        let err = null;
        try { t.transformSync(input); } catch (e) { const list = e?.errors?.length ? e.errors : [e]; err = list[0]; }
        if (err === null) continue;
        const key = String(err.message).replace(/"[^"]*"/g, '"…"');
        if (!res[name].has(key)) res[name].set(key, []);
        res[name].get(key).push(file.replace(root + "/", "") + " :: " + part.name + " :: " + (err.position?.lineText ?? "").trim());
      }
    }
  }
}
console.log("units that tsc parses:", n);
for (const name of ["II", "I"]) {
  console.log("== design", name, "failing:", [...res[name].values()].reduce((a, b) => a + b.length, 0));
  for (const [k, v] of [...res[name]].sort((a, b) => b[1].length - a[1].length)) {
    console.log(String(v.length).padStart(4), k);
    for (const f of v.slice(0, 6)) console.log("        " + f);
  }
}
