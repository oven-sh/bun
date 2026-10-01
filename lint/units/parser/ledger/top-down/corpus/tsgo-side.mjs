// What the parser of typescript-go says about every source of a corpus (parsediag, see ../tsgo-oracle).
//
//   bun tsgo-side.mjs <corpus.jsonl> <out.jsonl.gz> [--parsediag=/tmp/rr/parsediag]
//
// Output, gzip, one JSON value per line, the shape of tsc-side.mjs:
//   line 1    {"header":1,"typescriptGo":"89d5d5b","count"}
//   line 2..  {"id","ts":[n, [[code,start,length,message], ... at most 4]],"tsx":"=" or the same shape,
//              "dts": only for a record with "dts": true}
// n is -1 when the reference parser panicked (the message is kept as the only diagnostic, code 0).
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const bin = args.find(a => a.startsWith("--parsediag="))?.slice(12) ?? "/tmp/rr/parsediag";
const [corpusPath, outPath] = args.filter(a => !a.startsWith("--"));
if (!corpusPath || !outPath) {
  console.error("usage: bun tsgo-side.mjs <corpus.jsonl> <out.jsonl.gz> [--parsediag=<binary>]");
  process.exit(1);
}
const recs = readFileSync(corpusPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(l => JSON.parse(l));
function run(name, list) {
  const inPath = `${outPath}.${name}.in`;
  const resPath = `${outPath}.${name}.out`;
  writeFileSync(inPath, list.map(r => JSON.stringify({ id: r.id, name, text: r.src })).join("\n") + "\n");
  const p = spawnSync("sh", ["-c", `"${bin}" -max 4 < "${inPath}" > "${resPath}"`], { stdio: ["ignore", "inherit", "inherit"] });
  if (p.status !== 0) throw new Error(`parsediag failed for ${name}: ${p.status} ${p.signal}`);
  const out = new Map();
  for (const line of readFileSync(resPath, "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    out.set(r.id, r.panic ? [-1, [[0, 0, 0, r.panic.slice(0, 120)]]] : [r.n, r.d]);
  }
  rmSync(inPath, { force: true });
  rmSync(resPath, { force: true });
  if (out.size !== list.length) throw new Error(`${out.size} results for ${list.length} inputs (${name})`);
  return out;
}
const a = run("input.ts", recs);
const b = run("input.tsx", recs);
const dtsRecs = recs.filter(r => r.dts);
const c = dtsRecs.length ? run("input.d.ts", dtsRecs) : new Map();
const lines = [JSON.stringify({ header: 1, typescriptGo: "89d5d5b", count: recs.length })];
for (const r of recs) {
  const x = a.get(r.id);
  const y = b.get(r.id);
  const out = { id: r.id, ts: x, tsx: JSON.stringify(x) === JSON.stringify(y) ? "=" : y };
  if (c.has(r.id)) {
    const z = c.get(r.id);
    out.dts = JSON.stringify(x) === JSON.stringify(z) ? "=" : z;
  }
  lines.push(JSON.stringify(out));
}
writeFileSync(outPath, gzipSync(lines.join("\n") + "\n"));
console.log(`typescript-go 89d5d5b: ${recs.length} sources`);
void gunzipSync;
