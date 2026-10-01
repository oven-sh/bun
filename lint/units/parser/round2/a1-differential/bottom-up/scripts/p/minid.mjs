// <bun> minid.mjs <sources.json> : transformSync with minify.identifiers (and all of minify), ts and tsx, js and jsx
import { readFileSync } from "node:fs";
const cfgs = [
  ["ts.minid", { loader: "ts", minify: { identifiers: true } }],
  ["ts.minall", { loader: "ts", minify: true }],
  ["tsx.minid", { loader: "tsx", minify: { identifiers: true } }],
  ["js.plain", { loader: "js" }],
  ["jsx.plain", { loader: "jsx" }],
  ["js.minid", { loader: "js", minify: { identifiers: true } }],
].map(([n, o]) => [n, new Bun.Transpiler(o)]);
for (const src of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
  const out = {};
  for (const [n, t] of cfgs) {
    try { out[n] = ["o", t.transformSync(src)]; } catch (e) { out[n] = ["e", (e.errors?.length ? e.errors : [e]).map(x => String(x.message))]; }
  }
  console.log(JSON.stringify({ src, out }));
}
