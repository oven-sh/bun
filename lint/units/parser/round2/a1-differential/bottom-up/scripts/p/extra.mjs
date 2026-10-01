// <bun> extra.mjs <corpus.json> <out.jsonl> : the three configurations that harness.mjs lacks, one process
import { readFileSync, writeFileSync } from "node:fs";
import { expand } from "/tmp/a1bu/gd/harness.mjs";
const cfgs = [
  ["t.ts.plain.minid", { loader: "ts", minify: { identifiers: true } }],
  ["t.js.plain", { loader: "js" }],
  ["t.jsx.plain", { loader: "jsx" }],
].map(([n, o]) => [n, new Bun.Transpiler({ define: { "process.env.NODE_ENV": '"development"' }, ...o })]);
const inputs = expand(JSON.parse(readFileSync(process.argv[2], "utf8")));
const lines = [];
for (const input of inputs) {
  const res = [];
  for (const [, t] of cfgs) {
    try { res.push(["o", t.transformSync(input.src)]); } catch (e) { res.push(["e", (e.errors?.length ? e.errors : [e]).map(x => [String(x?.message ?? x), x?.position?.line ?? null, x?.position?.column ?? null])]); }
  }
  lines.push(JSON.stringify({ src: input.src, res }));
}
writeFileSync(process.argv[3], lines.join("\n") + "\n");
console.log(`${process.argv[3]}: ${inputs.length} inputs, bun ${Bun.revision}`);
