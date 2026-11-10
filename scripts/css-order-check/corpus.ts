// bun scripts/css-order-check/corpus.ts <list> <root> <main bun> <pr bun>
// Bundles each style sheet with both binaries and compares exit code and output bytes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [list, root, mainBin, prBin] = process.argv.slice(2);
const files = readFileSync(list, "utf8").split("\n").filter(Boolean);
const run = async (bin: string, file: string) => {
  const proc = Bun.spawn({ cmd: [bin, "build", file, "--minify-whitespace"], cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, code };
};
let same = 0, flips: string[] = [], bytes: string[] = [], bothFail = 0, fixed: string[] = [];
const parallel = 12;
for (let i = 0; i < files.length; i += parallel) {
  const batch = files.slice(i, i + parallel);
  const results = await Promise.all(batch.map(async f => [f, await run(mainBin, f), await run(prBin, f)] as const));
  for (const [f, a, b] of results) {
    if (a.code !== 0 && b.code !== 0) { bothFail++; continue; }
    if (a.code === 0 && b.code !== 0) { flips.push(f + " :: " + b.err.split("\n").find(l => l.startsWith("error")) ); continue; }
    if (a.code !== 0 && b.code === 0) { fixed.push(f); continue; }
    if (a.out === b.out) same++; else bytes.push(f);
  }
}
console.log(JSON.stringify({ files: files.length, sameBytes: same, failOnBoth: bothFail, flipToError: flips.length, failOnlyOnMain: fixed.length, bytesDiffer: bytes.length }));
for (const f of flips.slice(0, 40)) console.log("FLIP", f);
for (const f of bytes.slice(0, 40)) console.log("BYTES", f);
