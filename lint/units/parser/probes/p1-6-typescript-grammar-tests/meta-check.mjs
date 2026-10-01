// usage: bun meta-check.mjs   per type and position: the tag of tsc 6.0.2 (loose), the expected tag, what the bun that runs this writes
import { ofProperty, ofReturnType } from "./meta-rows.mjs";
import { tagOf, tagsOf, metadataCalls } from "../metadata.mjs";
import { writeFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const deco = new Bun.Transpiler({ loader: "ts", tsconfig: DECO });
const tscJs = src => ts.transpileModule(src, { fileName: "input.ts", compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, experimentalDecorators: true, emitDecoratorMetadata: true, strict: false, strictNullChecks: false, useDefineForClassFields: true, noEmitHelpers: true } }).outputText;
const parseOk = src => ts.createSourceFile("/input.ts", src, ts.ScriptTarget.ESNext, true).parseDiagnostics.map(d => "TS" + d.code);
const own = (src, key) => {
  try {
    const js = deco.transformSync(src);
    const call = metadataCalls(js).find(([k]) => k === "design:" + key);
    return call ? call[1].replace(/\s+/g, " ").replace(/^\[ /, "[").replace(/ \]$/, "]") : "(no call)";
  } catch (e) { return "ERR " + (e.errors?.[0]?.message ?? e.message); }
};
const rows = [];
const add = (position, type, tag) => {
  const src = position === "prop" ? `class C { @d p: ${type}; }` : position === "param" ? `class C { @d m(a: ${type}) {} }` : `class C { @d m(): ${type} { throw 0 } }`;
  const key = position === "prop" ? "type" : position === "param" ? "paramtypes" : "returntype";
  const expected = position === "param" ? `[${tag}]` : tag;
  const parse = parseOk(src);
  const tscTags = parse.length ? null : tagsOf(tscJs(src));
  const tscTag = tscTags ? tscTags[key] : "PARSE " + parse.join(",");
  const installed = own(src, key);
  rows.push({ position, type, src, key, expected, expectedTag: tagOf(expected), tscTag, installed, sameAsTsc: tagOf(expected) === tscTag, failsOnInstalled: installed !== expected });
};
for (const [type, tag] of ofProperty) for (const position of ["prop", "param", "ret"]) add(position, type, tag);
for (const [type, tag] of ofReturnType) add("ret", type, tag);
writeFileSync(new URL("meta-check.json", import.meta.url), JSON.stringify(rows, null, 1));
for (const r of rows) console.log(`${r.sameAsTsc ? "tsc=" : "TSC!"} ${r.failsOnInstalled ? "fails-on-installed" : "PASSES-ON-INSTALLED "} ${r.position.padEnd(5)} ${JSON.stringify(r.type).padEnd(52)} expected ${r.expectedTag.padEnd(16)} tsc ${String(r.tscTag).padEnd(16)} installed ${r.installed}`);
console.log(`bun ${Bun.version} ${Bun.revision} typescript ${ts.version}`);
