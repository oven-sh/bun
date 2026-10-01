// What the running bun does with each input: transform output or first error, and the import scan.
// usage: <bun> bunprobe.mjs inputs.json > bun.jsonl
import { readFileSync } from "fs";
const inputs = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const input of inputs) {
  const loader = input.tsx ? "tsx" : "ts";
  const tsconfig = { compilerOptions: input.deco ? { experimentalDecorators: true, emitDecoratorMetadata: true } : {} };
  const t = new Bun.Transpiler({ loader, target: "bun", tsconfig });
  const rec = { id: input.id };
  try { rec.out = t.transformSync(input.text).trim(); }
  catch (e) { rec.err = String(e?.errors?.[0]?.message ?? e?.message ?? e).split("\n")[0]; }
  try { rec.scan = t.scanImports(input.text).map(i => i.kind + ":" + i.path).join(","); }
  catch (e) { rec.scanErr = String(e?.errors?.[0]?.message ?? e?.message ?? e).split("\n")[0]; }
  try { rec.scan2 = t.scan(input.text).imports.map(i => i.kind + ":" + i.path).join(","); }
  catch (e) { rec.scan2Err = String(e?.errors?.[0]?.message ?? e?.message ?? e).split("\n")[0]; }
  console.log(JSON.stringify(rec));
}
