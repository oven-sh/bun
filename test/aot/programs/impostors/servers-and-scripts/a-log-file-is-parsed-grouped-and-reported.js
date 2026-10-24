import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = mkdtempSync(join(tmpdir(), "logs-"));
const file = join(folder, "access.log");
const paths = ["/", "/about", "/api/users", "/api/orders", "/static/app.js"];
const rows = [];
for (let i = 0; i < 400; i++) {
  const status = i % 37 === 0 ? 500 : i % 11 === 0 ? 404 : 200;
  rows.push(JSON.stringify({ time: new Date(Date.UTC(2026, 0, 1, 0, 0, i * 7)).toISOString(), method: i % 5 === 3 ? "POST" : "GET", path: paths[i % paths.length], status, ms: (i * 13) % 250 + 0.5, bytes: status === 200 ? 100 + i : undefined }));
}
rows.splice(50, 0, "this line is not json", "", '{"time": "broken"');
writeFileSync(file, rows.join("\n") + "\n");

const byPath = new Map();
let skipped = 0;
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    skipped++;
    continue;
  }
  let group = byPath.get(entry.path);
  if (!group) byPath.set(entry.path, (group = { path: entry.path, hits: 0, errors: 0, ms: 0, slowest: 0, bytes: 0, methods: new Set(), first: entry.time, last: entry.time }));
  group.hits++;
  if (entry.status >= 500) group.errors++;
  group.ms += entry.ms;
  group.slowest = Math.max(group.slowest, entry.ms);
  group.bytes += entry.bytes ?? 0;
  group.methods.add(entry.method);
  if (entry.time > group.last) group.last = entry.time;
}
const report = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)).map(group => ({ ...group, methods: [...group.methods].join("+"), mean: (group.ms / group.hits).toFixed(2), share: ((100 * group.hits) / 400).toFixed(1) + "%" }));
for (const line of report) console.log(line.path.padEnd(16), String(line.hits).padStart(4), String(line.errors).padStart(2), line.mean.padStart(8), String(line.slowest).padStart(6), line.bytes.toLocaleString("en-US").padStart(8), line.methods, line.share, line.last.slice(11, 19));
console.log("skipped", skipped, "total", report.reduce((sum, line) => sum + line.hits, 0), Object.groupBy(report, line => (line.errors ? "failing" : "healthy")).failing?.length);
const hours = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" }).format(new Date(report[0].last));
console.log(hours, new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(12345.678), new Intl.PluralRules("en").select(1), new Intl.ListFormat("en").format(["a", "b", "c"]), new Intl.RelativeTimeFormat("en").format(-2, "day"));
rmSync(folder, { recursive: true });
