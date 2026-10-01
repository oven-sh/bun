// Scratch: what the bun that runs this does with every test row. Output testrows.base.json
import { readFileSync, writeFileSync } from "node:fs";
const rows = JSON.parse(readFileSync("/tmp/gdo/testrows.json", "utf8"));
const DECO = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
const T = { js: new Bun.Transpiler({ loader: "js" }), ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }), deco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }) };
const out = rows.map(r => {
  try {
    return { ...r, base: ["o", T[r.loader].transformSync(r.src)] };
  } catch (e) {
    const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e];
    return { ...r, base: ["e", list.map(x => [String(x?.message ?? x), x?.position?.line ?? null, x?.position?.column ?? null])] };
  }
});
writeFileSync("/tmp/gdo/testrows.base.json", JSON.stringify(out));
let rej = 0, same = 0, diff = 0;
for (const r of out) {
  if (r.base[0] === "e") rej++;
  else if (r.key ? false : r.base[1] === r.expected) same++;
  else diff++;
}
console.log(Bun.version, Bun.revision, { rows: out.length, baseRejects: rej, baseSameOutput: same, baseOtherOutputOrMetadata: diff });
