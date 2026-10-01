// usage: <bun> conf-js.mjs <typescript.js> <tests/cases dir> <out.jsonl>
// Every JavaScript unit of the conformance cases: tsc's parse and JavaScript-only diagnostics against Bun's js/jsx and ts/tsx parse.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const ts = (await import(process.argv[2])).default;
const root = process.argv[3];
const outPath = process.argv[4];
const opts = loader => ({ loader, trimUnusedImports: false, target: "bun", deadCodeElimination: false, inline: false });
const T = { js: new Bun.Transpiler(opts("js")), jsx: new Bun.Transpiler(opts("jsx")), ts: new Bun.Transpiler(opts("ts")), tsx: new Bun.Transpiler(opts("tsx")) };
function bun(loader, src) {
  try { return { ok: true, out: T[loader].transformSync(src).replace(/"input\.[jt]sx?"/g, '"input.X"') }; }
  catch (e) { const l = e?.errors?.length ? e.errors : [e]; return { ok: false, err: l.map(x => String(x.message)) }; }
}
const files = [...new Bun.Glob((process.argv[5] ?? "**") + "/*.{ts,tsx,js,jsx,mjs,cjs}").scanSync({ cwd: root, absolute: true })].sort();
writeFileSync(outPath, "");
const c = {};
const bump = k => (c[k] = (c[k] ?? 0) + 1);
const codeCount = {};
for (const f of files) {
  let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
  const lines = text.split(/\r?\n/);
  let cur = { name: f.slice(root.length + 1).split("/").pop(), body: [] }; const secs = [];
  let sawDirective = false;
  for (const line of lines) {
    const m = /^\/\/\s*@filename\s*:\s*(\S+)\s*$/i.exec(line);
    if (m) { if (sawDirective || cur.body.some(l => l.trim() && !/^\/\/\s*@/.test(l))) secs.push(cur); cur = { name: m[1], body: [] }; sawDirective = true; }
    else cur.body.push(line);
  }
  secs.push(cur);
  for (const s of secs) {
    const m = /\.(js|jsx|mjs|cjs)$/i.exec(s.name);
    if (!m) continue;
    const ext = m[1].toLowerCase();
    const src = s.body.join("\n");
    bump("js units");
    bump(`js units .${ext}`);
    const fileName = "/" + s.name.replace(/^\/+/, "").replace(/^[a-z]:[\\/]/i, "");
    const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, true);
    const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, checkJs: false, noLib: true, noResolve: true, types: [], noEmit: true, strict: false, jsx: ts.JsxEmit.Preserve };
    const host = { getSourceFile: n => (n === fileName ? sf : undefined), getDefaultLibFileName: () => "lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: n => n, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: n => n === fileName, readFile: () => undefined };
    let jsDiag = [];
    try { const program = ts.createProgram([fileName], options, host); jsDiag = program.getSyntacticDiagnostics(sf).filter(d => !sf.parseDiagnostics.includes(d)).map(d => d.code); } catch { bump("program threw"); }
    const parseClean = sf.parseDiagnostics.length === 0;
    const j = ext === "mjs" || ext === "cjs" ? "js" : "jsx";
    const B = { js: bun("js", src), jsx: bun("jsx", src), ts: bun("ts", src), tsx: bun("tsx", src) };
    const nat = B[j];
    for (const code of new Set(jsDiag)) codeCount[code] = (codeCount[code] ?? 0) + 1;
    const ts8 = jsDiag.length > 0;
    const key = `tsc ${parseClean ? "parse-clean" : "parse-error"}${ts8 ? "+js-diag" : ""} | bun-${j} ${nat.ok ? "ok" : "err"} | bun-tsx ${B.tsx.ok ? "ok" : "err"}`;
    bump(key);
    if (B.jsx.ok && B.tsx.ok && B.jsx.out !== B.tsx.out) bump("jsx ok, tsx ok, OUTPUT DIFFERS");
    if (B.jsx.ok && !B.tsx.ok) bump("jsx ok, tsx REJECTS");
    if (B.js.ok && B.jsx.ok && B.js.out !== B.jsx.out) bump("js ok, jsx ok, OUTPUT DIFFERS");
    if (B.js.ok && !B.jsx.ok) bump("js ok, jsx REJECTS");
    if (!B.js.ok && B.jsx.ok) bump(`needs JSX .${ext}`);
    const interesting = (parseClean !== nat.ok) || (B.jsx.ok && B.tsx.ok && B.jsx.out !== B.tsx.out) || (B.jsx.ok && !B.tsx.ok) || ts8;
    if (interesting) appendFileSync(outPath, JSON.stringify({ file: f.slice(root.length + 1), unit: s.name, parse: sf.parseDiagnostics.map(d => d.code), jsDiag, bun: Object.fromEntries(Object.entries(B).map(([k, v]) => [k, v.ok ? "ok" : v.err[0]])), jsxVsTsx: B.jsx.ok && B.tsx.ok ? (B.jsx.out === B.tsx.out ? "same" : "differs") : "n/a" }) + "\n");
  }
}
console.log(JSON.stringify({ typescript: ts.version, bun: Bun.version + "+" + Bun.revision.slice(0, 9), counts: Object.fromEntries(Object.entries(c).sort()), unitsPerJsDiagCode: codeCount }, null, 1));
