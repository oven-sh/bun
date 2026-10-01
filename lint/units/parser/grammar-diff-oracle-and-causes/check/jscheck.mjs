// Scratch: what the binary that runs this does with sources under the js and jsx loaders.
//   <bun> jscheck.mjs <corpus.json> <out.jsonl> <start> <end>
import { appendFileSync, readFileSync } from "node:fs";
import { expand } from "/tmp/gdo/gd/harness.mjs";
const [corpusPath, outPath, start, end] = process.argv.slice(2);
const inputs = expand(JSON.parse(readFileSync(corpusPath, "utf8")));
const T = [new Bun.Transpiler({ loader: "js" }), new Bun.Transpiler({ loader: "jsx" })];
let buf = "";
for (let i = Number(start); i < Math.min(Number(end), inputs.length); i++) {
  const vals = T.map(t => { try { return ["o", t.transformSync(inputs[i].src)]; } catch (e) { const x = e?.errors?.[0] ?? e; return ["e", String(x?.message ?? x)]; } });
  buf += JSON.stringify({ i, src: inputs[i].src, vals }) + "\n";
}
appendFileSync(outPath, buf);
