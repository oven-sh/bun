// usage: <bun under test> rows-run.mjs <testrows.json> <out.json>   what the bun that runs this does with every row
import { readFileSync, writeFileSync } from "node:fs";
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const DECO = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
const T = {
  js: new Bun.Transpiler({ loader: "js" }),
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
  deco: new Bun.Transpiler({ loader: "ts", tsconfig: JSON.stringify(DECO) }),
};
// The value of the metadata key, as the test files read it.
function design(code, key, file) {
  if (file === "typescript-grammar-decorator-metadata.test.ts") {
    const m = new RegExp(`\\("design:${key}", (.*?)\\),?\\n`).exec(code);
    return m ? m[1] : null;
  }
  const m = new RegExp(`\\("design:${key}", ([^]*?)\\),?\\n`).exec(code);
  return m ? m[1].replace(/\s+/g, " ").replace(/^\[ /, "[").replace(/ \]$/, "]") : null;
}
const out = rows.map(r => {
  try {
    const code = T[r.loader].transformSync(r.src);
    const rec = { ...r, res: ["o", code] };
    if (r.key) rec.value = design(code, r.key, r.file);
    rec.pass = r.key ? rec.value === r.expected : code === r.expected;
    return rec;
  } catch (e) {
    const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e];
    return { ...r, res: ["e", list.map(x => [String(x?.message ?? x), x?.position?.line ?? null, x?.position?.column ?? null])], pass: false };
  }
});
writeFileSync(process.argv[3], JSON.stringify(out));
let rej = 0, pass = 0, other = 0;
for (const r of out) { if (r.res[0] === "e") rej++; else if (r.pass) pass++; else other++; }
console.log(Bun.version, Bun.revision, { rows: out.length, rejects: rej, pass, acceptsButOtherOutput: other });
