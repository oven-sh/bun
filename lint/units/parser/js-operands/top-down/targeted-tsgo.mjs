// Parses every targeted input with typescript-go's parser (the parse oracle built by ../../ledger/tsgo-oracle/build.sh)
// as a.js, a.jsx, a.mjs, a.cjs, a.ts, a.tsx. usage: bun targeted-tsgo.mjs [parsediag binary] > targeted-tsgo.jsonl
import { readFileSync } from "node:fs";
const bin = process.argv[2] ?? "/tmp/rr/parsediag";
const inputs = JSON.parse(readFileSync(new URL("./targeted-inputs.json", import.meta.url), "utf8"));
const names = ["a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.tsx"];
const flat = [];
for (const [group, list] of Object.entries(inputs)) for (const src of list) flat.push({ group, src });
const lines = [];
flat.forEach((item, i) => { for (const name of names) lines.push(JSON.stringify({ id: `${i} ${name}`, name, text: item.src })); });
const proc = Bun.spawnSync({ cmd: [bin, "-max", "16"], stdin: Buffer.from(lines.join("\n") + "\n"), stdout: "pipe", stderr: "pipe" });
if (proc.exitCode !== 0) { console.error(proc.stderr.toString()); process.exit(1); }
const rows = flat.map(item => ({ ...item }));
for (const line of proc.stdout.toString().trim().split("\n")) {
  const r = JSON.parse(line);
  const [i, name] = r.id.split(" ");
  const fmt = d => ({ code: d[0], start: d[1], length: d[2], text: d[3] });
  rows[+i][name] = { parse: r.d.map(fmt), js: (r.js ?? []).map(fmt), panic: r.panic };
}
for (const row of rows) console.log(JSON.stringify(row));
