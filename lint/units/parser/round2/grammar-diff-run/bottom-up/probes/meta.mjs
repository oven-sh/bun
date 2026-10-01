// bun meta.mjs <diff.jsonl> [filter]: per source with an A>A record of api t.ts.deco: cause, old metadata, new metadata, tsc (loose / strict).
import { readFileSync } from "node:fs";
import { bunMetadataOf } from "/tmp/gdr1a/gd/causes.mjs";
const [path, filter] = process.argv.slice(2);
const seen = new Map();
for (const line of readFileSync(path, "utf8").split("\n")) {
  if (!line) continue;
  const d = JSON.parse(line);
  if (d.cls !== "A>A" || d.api !== "t.ts.deco") continue;
  if (filter && !d.cause.includes(filter)) continue;
  const fmt = list => list.map(([k, v]) => `${k.replace("design:", "")}=${v}`).join("; ");
  const oldM = bunMetadataOf(d.base[1]), newM = bunMetadataOf(d.next[1]);
  const changed = newM.map((m, i) => (oldM[i] && oldM[i][1] !== m[1] ? i : -1)).filter(i => i >= 0);
  const pick = list => (list ? fmt(changed.length ? changed.map(i => list[i]).filter(Boolean) : list) : "-");
  seen.set(d.src, { cause: d.cause, src: d.src, old: pick(oldM), new: pick(newM), tscLoose: d.tsc?.metaLoose ? fmt(d.tsc.metaLoose) : d.tsc?.meta ? fmt(d.tsc.meta) : "(no emit: " + (d.tsc?.ts?.[0]?.[0] ? "TS" + d.tsc.ts[0][0] : "?") + ")", tscStrict: d.tsc?.meta ? fmt(d.tsc.meta) : "-" });
}
for (const r of seen.values()) console.log(JSON.stringify(r));
