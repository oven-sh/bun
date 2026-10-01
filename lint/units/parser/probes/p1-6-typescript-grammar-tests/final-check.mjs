// usage: bun final-check.mjs   every row of final-rows.mjs against tsc 6.0.2 and the bun that runs this
import { groups, metadata, ACCESSOR_X, STATIC_ACCESSOR_X } from "./final-rows.mjs";
import { tagOf, tagsOf, metadataCalls } from "../metadata.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const here = new URL(".", import.meta.url).pathname;
const flat = [];
for (const [group, rows] of groups) for (const row of rows) if (Array.isArray(row)) flat.push({ group, which: row[0] === "decorators" ? "deco" : row[0], src: row[1], expected: row[2] });
writeFileSync(here + "final.json", JSON.stringify(flat));
const r = spawnSync(process.execPath, [here + "oracle.mjs", here + "final.json", here + "final.oracle.json"], { stdio: "inherit" });
if (r.status !== 0) process.exit(1);
const { rows, bun } = JSON.parse(readFileSync(here + "final.oracle.json", "utf8"));
const plain = new Bun.Transpiler({ loader: "ts" });
let bad = 0;
const seen = new Set();
for (const r of rows) {
  const flags = [];
  const id = r.which + "\t" + r.src;
  if (seen.has(id)) flags.push("DUPLICATE");
  seen.add(id);
  if (r.tsc.parse.length) flags.push("TSC-PARSE " + r.tsc.parse.join(","));
  if (r.tsc.grammar.length) flags.push("TSC-GRAMMAR " + r.tsc.grammar.join(","));
  if (r.own.ok && r.own.out === r.expected) flags.push("PASSES-ON-INSTALLED");
  if (r.which === "deco" && /\baccessor\b/.test(r.src)) {
    if (plain.transformSync(r.src) !== r.expected) flags.push("NOT-WHAT-PLAIN-PRINTS");
  }
  if (flags.length) { bad++; console.log("!!", r.group, r.which, JSON.stringify(r.src), flags.join("; ")); }
}
console.log(`${rows.length} rows, ${bad} flagged, bun ${bun}`);
const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const deco = new Bun.Transpiler({ loader: "ts", tsconfig: DECO });
const tscJs = src => ts.transpileModule(src, { fileName: "input.ts", compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, experimentalDecorators: true, emitDecoratorMetadata: true, strict: false, strictNullChecks: false, useDefineForClassFields: true, noEmitHelpers: true } }).outputText;
function design(code, key) {
  const match = new RegExp(`\\("design:${key}", ([^]*?)\\),?\\n`).exec(code);
  if (!match) throw new Error(`no design:${key} in\n${code}`);
  return match[1].replace(/\s+/g, " ").replace(/^\[ /, "[").replace(/ \]$/, "]");
}
let metaBad = 0, metaRows = 0;
const seenMeta = new Set();
for (const row of metadata) {
  if (!Array.isArray(row)) continue;
  metaRows++;
  const [src, key, expected] = row;
  const flags = [];
  if (seenMeta.has(src)) flags.push("DUPLICATE");
  seenMeta.add(src);
  const parse = ts.createSourceFile("/input.ts", src, ts.ScriptTarget.ESNext, true).parseDiagnostics;
  if (parse.length) flags.push("TSC-PARSE");
  const tscTag = tagsOf(tscJs(src))[key];
  if (tscTag !== tagOf(expected)) flags.push(`TSC ${tscTag} != ${tagOf(expected)}`);
  const installed = design(deco.transformSync(src), key);
  if (installed === expected) flags.push("PASSES-ON-INSTALLED");
  if (flags.length) { metaBad++; console.log("!! metadata", JSON.stringify(src), key, flags.join("; ")); }
}
console.log(`${metaRows} metadata rows, ${metaBad} flagged`);
