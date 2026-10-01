// usage: bun bydescribe.ts <log> ...: the sum of the times of the tests of each describe, seconds, one column per log ("default check": the longest test).
import { readFileSync } from "node:fs";
import { basename } from "node:path";
const logs = process.argv.slice(2);
const names: string[] = [];
const sums = logs.map(() => new Map<string, number>());
logs.forEach((log, k) => {
  const seen = new Set<string>();
  for (const line of readFileSync(log, "utf8").split("\n")) {
    const m = /^\((pass|fail)\) (.*?) > (.*?)(?: \[([0-9.]+)ms\])?$/.exec(line);
    if (m === null || seen.has(m[2] + m[3])) continue;
    seen.add(m[2] + m[3]);
    if (!names.includes(m[2])) names.push(m[2]);
    const ms = Number(m[4] ?? 0);
    const was = sums[k].get(m[2]) ?? 0;
    sums[k].set(m[2], m[2] === "default check" ? Math.max(was, ms) : was + ms);
  }
});
console.log(logs.map(l => basename(l, ".log").replace(".plain", "").padStart(20)).join(" "));
for (const name of names) console.log(sums.map(s => ((s.get(name) ?? 0) / 1000).toFixed(1).padStart(20)).join(" ") + "  " + name);
