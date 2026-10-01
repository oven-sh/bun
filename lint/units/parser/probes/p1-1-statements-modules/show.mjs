// usage: bun show.mjs <out.jsonl> [filter: all|rejected-valid|aa-diff|b|gram]
import { readFileSync } from "node:fs";
const rows = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const filter = process.argv[3] ?? "all";
const norm = s => s.replace(/^"use strict"; ?/, "").replace(/^export \{\}; ?$/, "").replace(/ export \{\};$/, "");
for (const r of rows) {
  const bunOk = r.bun.startsWith("OK");
  const kind = r.cls === "OK" ? (bunOk ? "AA" : "A1c") : r.cls === "GRAM" ? (bunOk ? "AAg" : "A1s") : (bunOk ? "B" : "RR");
  if (filter === "rejected-valid" && kind !== "A1c") continue;
  if (filter === "gram" && kind !== "A1s") continue;
  if (filter === "b" && kind !== "B") continue;
  if (filter === "aa" && kind !== "AA" && kind !== "AAg") continue;
  console.log(kind.padEnd(4), JSON.stringify(r.src));
  console.log("      tsc ", r.cls, r.parse.join(","), r.grammar.join(","), r.other.length ? "(also " + r.other.join(",") + ")" : "");
  if (r.js !== null) console.log("      tsc.js ", JSON.stringify(norm(r.js)));
  console.log("      bun    ", r.bun.startsWith("OK") ? "OK  " + JSON.stringify(r.bun.slice(4)) : r.bun);
  if (r.bunTsx !== r.bun) console.log("      bun.tsx", r.bunTsx);
}
