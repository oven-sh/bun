// usage: <bun> compute.mjs   per row: tsc verdict, tsc's JavaScript printed by this bun's js loader, this bun's own result
import { groups } from "./rows.mjs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const tr = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }), js: new Bun.Transpiler({ loader: "js" }), jsx: new Bun.Transpiler({ loader: "jsx" }) };
const run = (l, s) => { try { return { ok: true, out: tr[l].transformSync(s) }; } catch (e) { return { ok: false, out: (e.errors?.[0]?.message ?? e.message).split("\n")[0] }; } };
const out = {};
for (const [name, rows] of Object.entries(groups)) {
  out[name] = [];
  for (const [loader, src] of rows) {
    const tsx = loader === "tsx";
    const sf = ts.createSourceFile(tsx ? "/i.tsx" : "/i.ts", src, ts.ScriptTarget.ESNext, false, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const parse = sf.parseDiagnostics.map(d => "TS" + d.code);
    const js = ts.transpileModule(src, { fileName: tsx ? "i.tsx" : "i.ts", compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve } }).outputText.replace(/^"use strict";\n/, "");
    const viaTsc = parse.length ? { ok: false, out: parse.join(",") } : run(tsx ? "jsx" : "js", js);
    const own = run(loader, src);
    out[name].push({ loader, src, tsc: parse.length ? parse.join(",") : "ok", expected: viaTsc.ok ? viaTsc.out : null, own });
  }
}
console.log(JSON.stringify({ bun: Bun.version + " " + Bun.revision, rows: out }, null, 1));
