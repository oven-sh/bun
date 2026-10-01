// Makes a file of --resume of the reports of the nine chunks of the survey of the debug build: the outcomes of `bun --lint` as the default check of 3110ce85cf read them.
import { readdirSync, statSync, writeFileSync } from "node:fs";
const [reports, out, check, corpus] = process.argv.slice(2);
const { size, mtimeMs } = statSync(check);
const lines = [JSON.stringify({ check, stamp: `${size} bytes, changed ${new Date(mtimeMs).toISOString()}`, corpus })];
let n = 0;
for (const file of readdirSync(reports).filter(f => f.endsWith(".json")).sort()) {
  const report = await Bun.file(`${reports}/${file}`).json();
  for (const [name, entry] of Object.entries<any>(report.instances)) {
    const { kind: _kind, casePath: _casePath, ...rest } = entry;
    lines.push(JSON.stringify({ name, ...rest }));
    n++;
  }
}
writeFileSync(out, lines.join("\n") + "\n");
console.log(`${n} outcomes`);
