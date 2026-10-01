// Compares the stored outputs of the verifiers in two trees, after the parts that change from run to run are taken out.
// usage: bun compare.ts <out dir of the base> <out dir of the overlay>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [a, b] = process.argv.slice(2);
const normalise = (s: string) =>
  s
    .replace(/\s*\[\d+(\.\d+)?\s?(ms|s)\]/g, "")
    .replace(/\b\d+(\.\d+)?\s?ms\b/g, "T ms")
    .replace(/"ms":\d+/g, '"ms":T')
    .replace(/"msWrite":\d+/g, '"msWrite":T')
    .replace(/\bms \d+/g, "ms T")
    .replace(/seconds \d+(\.\d+)?/g, "seconds T")
    .replace(/build T ms, run T ms/g, "build T ms, run T ms")
    .replace(/\/tmp\/[A-Za-z0-9._-]+\/(base|ovl-nodecode|ovl-nopatch|ovl-asm|ovl)\b/g, "<tree>")
    .replace(/\/tmp\/[A-Za-z0-9._-]+\/out-(base|ovl-nodecode|ovl-nopatch|ovl-asm|ovl)\b/g, "<out>")
    .replace(/lint-conformance[-A-Za-z0-9_]*/g, "lint-conformance-X")
    .replace(/ccds-[a-z]+-[A-Za-z0-9]+/g, "ccds-X")
    .replace(/Ran (\d+) tests across 1 file\. \[[^\]]*\]/g, "Ran $1 tests across 1 file.")
    .replace(/^\s+at .*$/gm, "   at <frame>");
let same = 0;
const different: string[] = [];
for (const f of readdirSync(a).filter(f => f.endsWith(".out")).sort()) {
  const x = normalise(readFileSync(join(a, f), "utf8"));
  let y: string;
  try {
    y = normalise(readFileSync(join(b, f), "utf8"));
  } catch {
    different.push(f + ": no output in the overlay");
    continue;
  }
  if (x === y) {
    same++;
    continue;
  }
  const xs = x.split("\n");
  const ys = y.split("\n");
  let k = 0;
  while (k < xs.length && k < ys.length && xs[k] === ys[k]) k++;
  different.push(`${f}: first difference at line ${k + 1}\n    base:    ${xs[k]?.slice(0, 300)}\n    overlay: ${ys[k]?.slice(0, 300)}`);
}
console.log(`verifier outputs: ${same} identical, ${different.length} different`);
for (const d of different) console.log("  " + d);
