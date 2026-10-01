// usage: <bun> tsgo-run.mjs <parsediag binary> > tsgo.json
// parsediag: the parse oracle of typescript-go, built by ../../ledger/tsgo-oracle/build.sh (default /tmp/rr/parsediag).
import { inputs } from "./inputs.mjs";
const bin = process.argv[2] ?? "/tmp/rr/parsediag";
const names = ["a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.tsx"];
const lines = [];
for (const [id, code] of inputs) for (const name of names) lines.push(JSON.stringify({ id: `${id} ${name}`, name, text: code }));
const proc = Bun.spawnSync({ cmd: [bin, "-max", "16"], stdin: Buffer.from(lines.join("\n") + "\n"), stdout: "pipe", stderr: "pipe" });
if (proc.exitCode !== 0) { console.error(proc.stderr.toString()); process.exit(1); }
const rows = {};
for (const line of proc.stdout.toString().trim().split("\n")) {
  const r = JSON.parse(line);
  const [id, name] = r.id.split(" ");
  const fmt = d => `TS${d[0]}@${d[1]}+${d[2]}`;
  (rows[id] ??= {})[name] = { parse: r.d.map(fmt), js: (r.js ?? []).map(d => `${fmt(d)} ${d[3]}`), jsdoc: (r.jsdoc ?? []).map(fmt), panic: r.panic };
}
console.log(JSON.stringify({ reference: "typescript-go 89d5d5b internal/parser", rows }, null, 1));
