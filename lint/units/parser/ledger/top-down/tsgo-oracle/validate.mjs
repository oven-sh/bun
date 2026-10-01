// Checks parsediag against the baselines that typescript-go ships for the parser conformance tests.
//
//   bun validate.mjs [--parsediag=/tmp/rr/parsediag]
//
// For every one-file test under _submodules/TypeScript/tests/cases/conformance/parser (no @filename line):
// the codes that parsediag reports must all appear in the error baseline of typescript-go
// (testdata/baselines/reference/submodule/conformance/<name>.errors.txt, every configuration of the test),
// and a test without an error baseline must parse without a diagnostic. The baseline holds the diagnostics
// of the parser and of the checker, so only this direction can be checked. The same is done with the
// parseDiagnostics of tsc 6.0.2 against the baselines of TypeScript (tests/baselines/reference).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

const REF = "/workspace/ref/typescript-go";
const CASES = join(REF, "_submodules/TypeScript/tests/cases/conformance/parser");
const GO_BASE = join(REF, "testdata/baselines/reference/submodule/conformance");
const TS_BASE = join(REF, "_submodules/TypeScript/tests/baselines/reference");
const bin = process.argv.find(a => a.startsWith("--parsediag="))?.slice(12) ?? "/tmp/rr/parsediag";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push(p);
  }
})(CASES);

const index = dir => {
  const map = new Map();
  for (const name of readdirSync(dir)) {
    const m = /^(.*?)(\(.*\))?\.errors\.txt$/.exec(name);
    if (!m) continue;
    if (!map.has(m[1])) map.set(m[1], []);
    map.get(m[1]).push(join(dir, name));
  }
  return map;
};
const goIndex = index(GO_BASE);
const tsIndex = index(TS_BASE);
const codesOf = paths => {
  const set = new Set();
  for (const p of paths) for (const m of readFileSync(p, "utf8").matchAll(/error TS(\d+):/g)) set.add(Number(m[1]));
  return set;
};

const tests = [];
let skipped = 0;
for (const path of files) {
  const text = readFileSync(path, "utf8").replace(/^\ufeff/, "");
  if (/^\s*\/\/\s*@filename\s*:/im.test(text)) {
    skipped++;
    continue;
  }
  tests.push({ path, name: basename(path).replace(/\.tsx?$/, ""), ext: path.endsWith(".tsx") ? "tsx" : "ts", text });
}
const inPath = "/tmp/parsediag-validate.in";
writeFileSync(inPath, tests.map((t, i) => JSON.stringify({ id: i, name: `input.${t.ext}`, text: t.text })).join("\n") + "\n");
const run = spawnSync("sh", ["-c", `"${bin}" -max 200 < ${inPath}`], { encoding: "utf8", maxBuffer: 1 << 28 });
if (run.status !== 0) throw new Error("parsediag failed: " + run.stderr);
const go = run.stdout
  .split("\n")
  .filter(Boolean)
  .map(l => JSON.parse(l));

const report = { go: { ok: 0, cleanOk: 0, extraCode: [], noBaselineButDiag: [] }, tsc: { ok: 0, cleanOk: 0, extraCode: [], noBaselineButDiag: [] } };
tests.forEach((t, i) => {
  const sides = [
    ["go", [...new Set(go[i].d.map(d => d[0]))], goIndex],
    ["tsc", [...new Set(ts.createSourceFile(`input.${t.ext}`, t.text, ts.ScriptTarget.ESNext, false).parseDiagnostics.map(d => d.code))], tsIndex],
  ];
  for (const [side, codes, idx] of sides) {
    const base = idx.get(t.name);
    if (!base) {
      if (codes.length === 0) report[side].cleanOk++;
      else report[side].noBaselineButDiag.push(`${t.name}: ${codes.join(",")}`);
      continue;
    }
    const allowed = codesOf(base);
    const extra = codes.filter(c => !allowed.has(c));
    if (extra.length === 0) report[side].ok++;
    else report[side].extraCode.push(`${t.name}: ${extra.join(",")} not in ${[...allowed].join(",")}`);
  }
});
console.log(`parser conformance tests: ${files.length} files, ${skipped} with @filename skipped, ${tests.length} checked`);
for (const [side, label] of [
  ["go", "parsediag (typescript-go 89d5d5b) against the baselines of typescript-go"],
  ["tsc", "tsc 6.0.2 parseDiagnostics against the baselines of TypeScript 5848bc5"],
]) {
  const r = report[side];
  console.log(`${label}:`);
  console.log(`  has an error baseline and every parse code is in it: ${r.ok}`);
  console.log(`  no error baseline and no parse diagnostic: ${r.cleanOk}`);
  console.log(`  a parse code that the baseline lacks: ${r.extraCode.length}`);
  for (const l of r.extraCode.slice(0, 12)) console.log(`    ${l}`);
  console.log(`  no error baseline but a parse diagnostic: ${r.noBaselineButDiag.length}`);
  for (const l of r.noBaselineButDiag.slice(0, 12)) console.log(`    ${l}`);
}
void existsSync;
