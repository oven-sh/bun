// usage: bun table.ts <log> [<log> ...]: the time of every test of each log side by side, ms; the tests above a threshold are marked.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
const logs = process.argv.slice(2);
const rows = new Map<string, (number | string)[]>();
const order: string[] = [];
logs.forEach((log, k) => {
  for (const line of readFileSync(log, "utf8").split("\n")) {
    const m = /^\((pass|fail|skip)\) (.*?)(?: \[([0-9.]+)ms\])?$/.exec(line);
    if (m === null) continue;
    const name = m[2];
    if (!rows.has(name)) {
      rows.set(name, logs.map(() => ""));
      order.push(name);
    }
    rows.get(name)![k] = m[1] === "skip" ? "skip" : m[1] === "fail" ? `FAIL ${m[3] ?? ""}` : Math.round(Number(m[3] ?? 0));
  }
});
const min = Number(process.env.MIN ?? 0);
console.log(logs.map(l => basename(l, ".log")).join(" | "));
for (const name of order) {
  const r = rows.get(name)!;
  const most = Math.max(...r.map(v => (typeof v === "number" ? v : typeof v === "string" && v.startsWith("FAIL") ? 1e9 : 0)));
  if (most < min) continue;
  console.log(r.map(v => String(v).padStart(7)).join(" ") + "  " + name.slice(0, 140));
}
