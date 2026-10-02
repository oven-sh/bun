// What the bun that runs this file does with the 153 sources of round2/a1-differential/top-down/probes/valid.plain.txt (loader ts).
// usage: <bun under test> valid-plain.mjs [out.json]
import { readFileSync, writeFileSync } from "node:fs";
const path = "/workspace/notes/lint/units/parser/round2/a1-differential/top-down/probes/valid.plain.txt";
const srcs = readFileSync(path, "utf8").split("\n").filter(l => l.length > 0 && !l.startsWith("# ")).map(l => l.replaceAll("\u23ce", "\n"));
const t = new Bun.Transpiler({ loader: "ts" });
const out = srcs.map(src => {
  try { return { src, got: ["o", t.transformSync(src)] }; }
  catch (e) { const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e]; return { src, got: ["e", list.map(x => [String(x?.message ?? x), x?.position?.line ?? null, x?.position?.column ?? null])] }; }
});
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ revision: Bun.revision, out }));
const rejected = out.filter(o => o.got[0] === "e").length;
console.log(`${Bun.revision}: ${out.length} sources, ${rejected} rejected, ${out.length - rejected} accepted`);
for (const o of out) if (o.got[0] !== "e") console.log("  accepted:", JSON.stringify(o.src));
