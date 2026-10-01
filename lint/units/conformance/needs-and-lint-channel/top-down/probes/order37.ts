import { existsSync, readFileSync } from "node:fs";
const P = "/workspace/notes/lint/units/conformance/enumerator/prototype/";
const E = "/workspace/notes/lint/units/conformance/error-baseline-format/top-down/";
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { tsgoRules } = await import(E + "diagnosticwriter.ts");
const { readErrorBaseline } = await import(E + "reader.ts");
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const baselines = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const e = enumerateInstances({ casesRoot });
let reversed = 0, pairs = 0; const names: string[] = [];
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const oracle = baselines + "/" + i.suite + "/" + i.name.replace(/\.tsx?$/, ".errors.txt");
  if (!existsSync(oracle)) continue;
  const text = readFileSync(oracle).toString("latin1");
  if (text.startsWith("\x1b[")) continue;
  const read: any = readErrorBaseline(tsgoRules, text, {});
  let prev: any, rev = false;
  for (const d of read.diagnostics) {
    if (d.file !== undefined && prev && prev.file === d.file && prev.pos === d.pos && prev.end !== d.end) {
      pairs++;
      if (prev.code > d.code) rev = true;
    }
    prev = d.file === undefined ? undefined : d;
  }
  if (rev) { reversed++; if (names.length < 6) names.push(i.suite + "/" + i.name); }
}
console.log(JSON.stringify({ pairsWithSameStartAndOtherEnd: pairs, baselinesWhereCodeOrderReversesEndOrder: reversed, names }));
