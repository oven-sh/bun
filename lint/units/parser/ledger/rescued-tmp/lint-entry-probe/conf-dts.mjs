import { readFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const t = new Bun.Transpiler({ loader: "ts" });
function bun(src) { try { t.transformSync(src); return null; } catch (e) { const l = e?.errors?.length ? e.errors : [e]; return l.map(x => ({ m: String(x.message), line: x.position?.lineText?.trim().slice(0, 100) })); } }
function isDecl(name) { const base = name.split(/[\\/]/).pop(); return /\.d\.(ts|mts|cts)$/.test(base) || (base.endsWith(".ts") && base.includes(".d.")); }
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const files = [...new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: root, absolute: true })].sort();
let units = 0, sections = 0, tscOk = 0, plainRej = 0, wrappedRej = 0;
const unitsFailingPlain = new Set(), unitsFailingWrapped = new Set();
const causesPlain = new Map(), causesWrapped = new Map();
for (const f of files) {
  let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
  units++;
  // split into sections by "// @filename: name"
  const lines = text.split(/\r?\n/);
  let cur = { name: f.slice(root.length + 1), body: [] }; const secs = [];
  let sawDirective = false;
  for (const line of lines) {
    const m = /^\/\/\s*@filename\s*:\s*(\S+)\s*$/i.exec(line);
    if (m) { if (sawDirective || cur.body.some(l => l.trim() && !/^\/\/\s*@/.test(l))) secs.push(cur); cur = { name: m[1], body: [] }; sawDirective = true; }
    else cur.body.push(line);
  }
  secs.push(cur);
  for (const s of secs) {
    if (!isDecl(s.name)) continue;
    const src = s.body.join("\n");
    sections++;
    const sf = ts.createSourceFile("/" + s.name.replace(/^\/+/, ""), src, ts.ScriptTarget.ESNext, false);
    if (sf.parseDiagnostics.length) continue;
    tscOk++;
    const p = bun(src);
    if (p) {
      plainRej++; unitsFailingPlain.add(f);
      const k = p[0].m.replace(/"[^"]*"/g, '"…"'); if (!causesPlain.has(k)) causesPlain.set(k, []); causesPlain.get(k).push(`${p[0].line}   <${f.slice(root.length + 1)} :: ${s.name}>`);
      const w = bun(`declare module "m" {\n${src}\n}`);
      if (w) { wrappedRej++; unitsFailingWrapped.add(f); const k2 = w[0].m.replace(/"[^"]*"/g, '"…"'); if (!causesWrapped.has(k2)) causesWrapped.set(k2, []); causesWrapped.get(k2).push(`${w[0].line}   <${f.slice(root.length + 1)} :: ${s.name}>`); }
    }
  }
}
console.log({ units, declarationSections: sections, tscParsesClean: tscOk, bunPlainRejects: plainRej, unitsWithPlainReject: unitsFailingPlain.size, bunWrappedRejects: wrappedRej, unitsWithWrappedReject: unitsFailingWrapped.size });
console.log("\nPLAIN causes");
for (const [k, v] of [...causesPlain].sort((a, b) => b[1].length - a[1].length)) { console.log(`[${v.length}] ${k}`); for (const x of v.slice(0, 3)) console.log("      " + x); }
console.log("\nWRAPPED (ambient approximation) causes");
for (const [k, v] of [...causesWrapped].sort((a, b) => b[1].length - a[1].length)) { console.log(`[${v.length}] ${k}`); for (const x of v.slice(0, 6)) console.log("      " + x); }
