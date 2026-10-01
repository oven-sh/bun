// <bun> tscases-run.mjs <out.jsonl> : ts (or tsx) plain and with experimentalDecorators+emitDecoratorMetadata, per unit
import { readFileSync, writeFileSync } from "node:fs";
const DECO = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
const T = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }), tsD: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }), tsxD: new Bun.Transpiler({ loader: "tsx", tsconfig: DECO }) };
const units = JSON.parse(readFileSync("/tmp/a1bu/p/tscases.json", "utf8"));
const lines = [];
for (const u of units) {
  const res = [];
  for (const t of [u.tsx ? T.tsx : T.ts, u.tsx ? T.tsxD : T.tsD]) {
    try { res.push(["o", t.transformSync(u.src)]); } catch (e) { res.push(["e", (e.errors?.length ? e.errors : [e]).map(x => [String(x?.message ?? x), x?.position?.line ?? null, x?.position?.column ?? null])]); }
  }
  lines.push(JSON.stringify(res));
}
writeFileSync(process.argv[2], lines.join("\n") + "\n");
console.log(process.argv[2], units.length, Bun.revision);
