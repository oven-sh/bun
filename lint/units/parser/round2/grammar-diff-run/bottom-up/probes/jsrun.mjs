// <bun> jsrun.mjs <corpus.json> <out.jsonl>: every source of a corpus under the js and jsx loaders: output or error list.
import { readFileSync, writeFileSync } from "node:fs";
import { expand } from "/tmp/gdr1a/gd/harness.mjs";
const inputs = expand(JSON.parse(readFileSync(process.argv[2], "utf8")));
const tr = { js: new Bun.Transpiler({ loader: "js" }), jsx: new Bun.Transpiler({ loader: "jsx" }) };
const out = [];
for (const input of inputs) {
  const r = {};
  for (const k of ["js", "jsx"]) {
    try { r[k] = ["o", tr[k].transformSync(input.src)]; } catch (e) { const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e]; r[k] = ["e", list.map(x => String(x?.message ?? x))]; }
  }
  out.push(JSON.stringify(r));
}
writeFileSync(process.argv[3], out.join("\n") + "\n");
console.log(inputs.length, "sources", Bun.revision.slice(0, 10));
