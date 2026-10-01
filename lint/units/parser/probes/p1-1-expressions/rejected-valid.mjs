import { readFileSync } from "node:fs";
const d = process.argv[3] ?? "ts";
const recs = readFileSync(process.argv[2], "utf8").trim().split("\n").map(l => JSON.parse(l));
const skip = new RegExp(process.argv[4] ?? "$^");
for (const r of recs) {
  const t = r[d];
  if (t.bun.startsWith("OK") || t.cls !== "OK") continue;
  if (skip.test(r.src)) continue;
  console.log(JSON.stringify(r.src).padEnd(54), "|", t.bun.slice(4, 40).padEnd(36), "| js:", r.bunjs.slice(0, 3), "|", t.other.filter(c => !/TS(2304|7006|2318|2695|7031|7019|2693|1308|2311)$/.test(c)).join(","));
}
