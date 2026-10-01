// node meta3.mjs <sources.json> : base, head and tsc (strictNullChecks off) metadata tags per source
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { metadataCalls, tagOf } from "/tmp/a1bu/cand/probes/metadata.mjs";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const M = "/workspace/notes/lint/measure/parser";
const file = process.argv[2];
const run = bin => execFileSync(`${M}/${bin}/bun`, ["/tmp/a1bu/p/bunmeta.mjs", file], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean).map(l => JSON.parse(l));
const base = run("base"), head = run("head");
const tags = v => (v[0] === "e" ? "ERR " + v[1][0] : metadataCalls(v[1]).map(([k, x]) => `${k.slice(7)}=${tagOf(x)}`).join(" ") || "(no metadata)");
const emit = src => ts.transpileModule(src, { fileName: "/input.ts", reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, experimentalDecorators: true, emitDecoratorMetadata: true, useDefineForClassFields: false, verbatimModuleSyntax: false, strictNullChecks: false } });
for (let i = 0; i < base.length; i++) {
  const r = emit(base[i].src);
  const t = metadataCalls(r.outputText).map(([k, x]) => `${k.slice(7)}=${tagOf(x)}`).join(" ") || "(no metadata)";
  const diag = r.diagnostics.length ? ` [tsc parse: TS${r.diagnostics[0].code}]` : "";
  const b = tags(base[i].v), h = tags(head[i].v);
  const mark = h === t ? (b === t ? "  " : "ok") : b === t ? "!!" : "??";
  console.log(`${mark} ${JSON.stringify(base[i].src)}\n     base ${b}\n     head ${h}\n     tsc  ${t}${diag}`);
}
