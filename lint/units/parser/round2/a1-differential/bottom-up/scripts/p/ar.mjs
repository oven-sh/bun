// <bun> ar.mjs <sources.json> : per source, accept/reject under ts plain, ts exp(erimentalDecorators), tsx plain
import { readFileSync } from "node:fs";
const EXP = { compilerOptions: { experimentalDecorators: true } };
const apis = [["ts", { loader: "ts" }], ["exp", { loader: "ts", tsconfig: EXP }], ["tsx", { loader: "tsx" }]].map(([n, o]) => [n, new Bun.Transpiler(o)]);
for (const src of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
  const out = [];
  for (const [n, t] of apis) {
    try { const o = t.transformSync(src); out.push(`${n}:A ${JSON.stringify(o).slice(0, 70)}`); } catch (e) { out.push(`${n}:R ${(e.errors?.length ? e.errors : [e]).map(x => x.message)[0]}`); }
  }
  console.log(JSON.stringify({ src, out }));
}
