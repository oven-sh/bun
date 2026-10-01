import { readFileSync } from "node:fs";
const { rows } = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const r of rows) {
  if (r.skip) continue;
  if (typeof r.expected === "string" && r.viaTsc?.ok && r.viaTsc.out !== r.expected) {
    console.log(`[${r.group} / ${r.which}] ${JSON.stringify(r.src)}`);
    console.log("   candidate:", JSON.stringify(r.expected).slice(0, 300));
    console.log("   via tsc  :", JSON.stringify(r.viaTsc.out).slice(0, 300));
    console.log("   tsc js   :", JSON.stringify(r.tscJs).slice(0, 300));
    console.log("   note     :", r.note.slice(0, 200));
  }
  if (r.viaTsc && !r.viaTsc.ok) console.log(`[${r.group} / ${r.which}] ${JSON.stringify(r.src)}  tsc js not printable: ${r.viaTsc.message}  js=${JSON.stringify(r.tscJs).slice(0, 200)}`);
}
