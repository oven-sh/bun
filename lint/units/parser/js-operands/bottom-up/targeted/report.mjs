// usage: <bun or node> report.mjs > report.txt
import { readFileSync } from "node:fs";
import { inputs } from "./inputs.mjs";
const bun = JSON.parse(readFileSync(new URL("./bun.json", import.meta.url), "utf8"));
const tsc = JSON.parse(readFileSync(new URL("./tsc.json", import.meta.url), "utf8"));
const go = JSON.parse(readFileSync(new URL("./tsgo.json", import.meta.url), "utf8"));
const one = s => s.replace(/\n/g, "\\n");
const b = r => (r.ok ? "OK  " + one(r.out.trimEnd()) : "ERR " + r.err[0]);
const t = r => `${r.parse.length ? "parse[" + r.parse.join(",") + "]" : "parse-clean"}${r.js.length ? " js[" + r.js.map(x => x.split(" ")[0]).join(",") + "]" : ""}  ${r.tree}`;
console.log(`bun ${bun.version}+${bun.revision.slice(0, 9)}  typescript ${tsc.typescript}  node ${tsc.node}\n`);
const sum = {};
for (const [id, code] of inputs) {
  const B = bun.rows[id], T = tsc.rows[id];
  const v8 = T.v8.script === "ok" || T.v8.module === "ok";
  const same = (x, y) => x.ok === y.ok && (x.ok ? x.out === y.out : true);
  const tags = [];
  tags.push(v8 ? "v8:valid" : "v8:invalid");
  tags.push(B.js.ok ? "bun-js:ok" : "bun-js:err", B.jsx.ok ? "bun-jsx:ok" : "bun-jsx:err");
  if (!same(B.js, B.ts)) tags.push("BUN js!=ts");
  if (!same(B.jsx, B.tsx)) tags.push("BUN jsx!=tsx");
  if (T["a.js"].tree !== T["a.ts"].tree || T["a.js"].parse.join() !== T["a.ts"].parse.join()) tags.push("TSC js!=ts");
  if (T["a.js"].tree !== T["a.tsx"].tree || T["a.js"].parse.join() !== T["a.tsx"].parse.join()) tags.push("TSC js!=tsx");
  if (T["a.js"].tree !== T["a.mjs"].tree || T["a.js"].tree !== T["a.cjs"].tree || T["a.js"].tree !== T["a.jsx"].tree) tags.push("TSC js kinds differ");
  {
    const G = go.rows[id]["a.js"];
    if (G.parse.join() !== T["a.js"].parse.join()) tags.push("GO!=TSC parse");
    if (G.js.map(x => x.split(" ")[0]).join() !== T["a.js"].js.map(x => x.split(" ")[0]).join()) tags.push("GO!=TSC js-diag");
  }
  const g = id[0];
  sum[g] ??= {};
  for (const tag of tags) sum[g][tag] = (sum[g][tag] ?? 0) + 1;
  console.log(`## ${id}  ${JSON.stringify(code)}\n   [${tags.join("] [")}]`);
  console.log(`   v8      script=${T.v8.script === "ok" ? "ok" : "ERR " + T.v8.script}  module=${T.v8.module === "ok" ? "ok" : "ERR " + T.v8.module}`);
  console.log(`   bun js  ${b(B.js)}\n   bun jsx ${b(B.jsx)}\n   bun ts  ${b(B.ts)}\n   bun tsx ${b(B.tsx)}`);
  console.log(`   tsc .js ${t(T["a.js"])}\n   tsc .ts ${t(T["a.ts"])}\n   tsc .tsx ${t(T["a.tsx"])}`);
  const G = go.rows[id]["a.js"];
  console.log(`   go  .js ${G.parse.length ? "parse[" + G.parse.join(",") + "]" : "parse-clean"}${G.js.length ? " js[" + G.js.map(x => x.split(" ")[0]).join(",") + "]" : ""}${G.panic ? " PANIC " + G.panic : ""}`);
  for (const d of T["a.js"].js) console.log(`      js-diag ${d}`);
  for (const [i, d] of T["a.js"].parseText.entries()) console.log(`      js-parse ${T["a.js"].parse[i]} ${d}`);
}
console.log("\n# summary by group\n" + JSON.stringify(sum, null, 1));
