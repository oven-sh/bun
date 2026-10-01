import { readFileSync } from "node:fs";
import { metadataCalls, tagOf } from "/tmp/a1bu/cand/probes/metadata.mjs";
const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const want = process.argv[3];
const byForm = new Map();
for (const line of lines) {
  const d = JSON.parse(line);
  if (d.cls !== "A>A") continue;
  if (want && !d.cause.startsWith(want)) continue;
  const key = d.t ?? d.src;
  if (!byForm.has(key)) byForm.set(key, { ctx: new Set(), apis: new Set(), ex: d, cause: d.cause });
  byForm.get(key).ctx.add(d.ctx);
  byForm.get(key).apis.add(d.api);
}
const tags = text => metadataCalls(text).map(([k, v]) => `${k.slice(7)}=${tagOf(v)}`).join(" ");
for (const [t, f] of [...byForm].sort()) {
  const d = f.ex;
  const tsc = d.tsc?.metaLoose ?? d.tsc?.meta;
  console.log(`${JSON.stringify(t)}\t[${[...f.ctx].join(",")}]\t${f.cause}`);
  console.log(`    src  ${JSON.stringify(d.src)}`);
  console.log(`    base ${tags(d.base[1])}`);
  console.log(`    head ${tags(d.next[1])}`);
  console.log(`    tsc  ${tsc ? tsc.map(([k, v]) => `${k.slice(7)}=${tagOf(v)}`).join(" ") : "(no value: " + (d.tsc?.ts?.[0] ? "TS" + d.tsc.ts[0][0] + " " + d.tsc.ts[0][3] : "?") + ")"}`);
}
console.log(byForm.size, "forms");
