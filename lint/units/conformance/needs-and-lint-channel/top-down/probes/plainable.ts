// Counts the oracle baselines that the plain format of a command line can rebuild: no span length and no related information is needed.
import { existsSync, readFileSync } from "node:fs";
const P = "/workspace/notes/lint/units/conformance/enumerator/prototype/";
const E = "/workspace/notes/lint/units/conformance/error-baseline-format/top-down/";
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { tsgoRules } = await import(E + "diagnosticwriter.ts");
const { readErrorBaseline, ReadError } = await import(E + "reader.ts");
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const baselines = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const e = enumerateInstances({ casesRoot });
let run = 0, E_ = 0, C_ = 0, pretty = 0, readFail = 0;
let needLen = 0, needRel = 0, needEither = 0, plainOk = 0;
let diags = 0, located = 0, zeroLen = 0, withRel = 0, relEntries = 0, noFile = 0;
let sameStart = 0, sameStartDiffEnd = 0;
for (const i of e.instances) {
  if (i.status !== "run") continue;
  run++;
  const oracle = baselines + "/" + i.suite + "/" + i.name.replace(/\.tsx?$/, ".errors.txt");
  if (!existsSync(oracle)) { C_++; continue; }
  E_++;
  const text = readFileSync(oracle).toString("latin1");
  if (text.startsWith("\x1b[")) { pretty++; continue; }
  let read: any;
  try { read = readErrorBaseline(tsgoRules, text, {}); } catch (err) { if (err instanceof ReadError) { readFail++; continue; } throw err; }
  let len = false, rel = false;
  let prev: any;
  let ss = false, ssd = false;
  for (const d of read.diagnostics as any[]) {
    diags++;
    if (d.relatedInformation.length > 0) { rel = true; withRel++; relEntries += d.relatedInformation.length; }
    if (d.file === undefined) { noFile++; prev = undefined; continue; }
    located++;
    const lib = /(^|\/)lib\.[^/]*\.d\.ts$/.test(String(tsgoRules.model.toString(d.file.fileName)));
    if (d.end === d.pos) zeroLen++;
    else if (!lib) len = true;
    if (prev && prev.file === d.file && prev.pos === d.pos) { ss = true; if (prev.end !== d.end) ssd = true; }
    prev = d;
  }
  if (ss) sameStart++;
  if (ssd) sameStartDiffEnd++;
  if (len) needLen++;
  if (rel) needRel++;
  if (len || rel) needEither++; else plainOk++;
}
console.log(JSON.stringify({ run, E: E_, C: C_, pretty, readFail, baselinesThatNeedLength: needLen, baselinesThatNeedRelated: needRel, needEither, plainOk, diags, located, noFile, zeroLen, diagnosticsWithRelated: withRel, relEntries, sameStart, sameStartDiffEnd }, null, 1));
