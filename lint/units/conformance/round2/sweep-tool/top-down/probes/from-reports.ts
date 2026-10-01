// usage: bun from-reports.ts <directory of reports of sweep.ts> <out.jsonl> <binary under test> <corpus root>
// Makes a file of --resume of the reports of a sweep that ran in chunks: the head that sweep.ts of this prototype writes for --bin <binary>, then an outcome for each instance of the reports.
import { readdirSync, statSync, writeFileSync } from "node:fs";
const [reports, out, binary, corpus] = process.argv.slice(2);
const { size, mtimeMs } = statSync(binary);
const stamp = `${binary}: ${size} bytes, changed ${new Date(mtimeMs).toISOString()}`;
const lines = [JSON.stringify({ check: `${binary} --lint`, stamp, corpus })];
for (const file of readdirSync(reports).filter(f => f.endsWith(".json")).sort()) {
  const report = await Bun.file(`${reports}/${file}`).json();
  for (const [name, entry] of Object.entries<any>(report.instances)) {
    const { kind: _kind, casePath: _casePath, ...rest } = entry;
    lines.push(JSON.stringify({ name, ...rest }));
  }
}
writeFileSync(out, lines.join("\n") + "\n");
console.log(`${lines.length - 1} outcomes`);
