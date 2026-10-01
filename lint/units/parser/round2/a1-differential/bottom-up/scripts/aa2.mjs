// A>A records of sources that tsc does not parse: base tags, head tags, and what tsc emits in spite of its diagnostics.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { metadataCalls, tagOf } from "/tmp/a1bu/cand/probes/metadata.mjs";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const emit = (src, extra) => ts.transpileModule(src, { fileName: "/input.ts", reportDiagnostics: false, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, experimentalDecorators: true, emitDecoratorMetadata: true, useDefineForClassFields: false, verbatimModuleSyntax: false, strictNullChecks: false, ...extra } }).outputText;
const tags = text => metadataCalls(text).map(([k, v]) => `${k.slice(7)}=${tagOf(v)}`).join(" ");
const tscTags = text => [...text.matchAll(/__metadata\("(design:\w+)", /g)].length ? metadataCalls(text).map(([k, v]) => `${k.slice(7)}=${tagOf(v)}`).join(" ") : "(none)";
const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const seen = new Set();
const fam = new Map();
for (const line of lines) {
  const d = JSON.parse(line);
  if (d.cls !== "A>A" || !d.cause.startsWith("ruling: metadata of a source that tsc does not parse")) continue;
  if (seen.has(d.src)) continue;
  seen.add(d.src);
  const b = tags(d.base[1]);
  const h = tags(d.next[1]);
  let t;
  try { t = tscTags(emit(d.src, {})); } catch (e) { t = "threw " + String(e.message).slice(0, 60); }
  const sort = s => s.split(" ").sort().join(" ");
  const rel = sort(h) === sort(t) ? "head=tsc" : sort(b) === sort(t) ? "base=tsc" : "neither";
  const key = `${rel}\t${b} -> ${h}\ttsc ${t}`;
  if (!fam.has(key)) fam.set(key, []);
  fam.get(key).push(d.src);
}
for (const [key, srcs] of [...fam].sort()) {
  console.log(`${String(srcs.length).padStart(4)}  ${key}`);
  for (const s of srcs.slice(0, 4)) console.log(`        ${JSON.stringify(s)}`);
}
console.log(seen.size, "sources");
