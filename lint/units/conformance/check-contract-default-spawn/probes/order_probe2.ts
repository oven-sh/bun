import { readdirSync, readFileSync } from "node:fs";
const E = new URL("../../error-baseline-format/top-down/", import.meta.url).pathname;
const { tsgoRules } = await import(E + "diagnosticwriter.ts");
const { readErrorBaseline } = await import(E + "reader.ts");
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
let affected = 0, total = 0, libMixed = 0, globalFirst = 0, globalNotFirst = 0;
for (const suite of ["compiler", "conformance"]) {
  for (const f of readdirSync(GO + "/" + suite).sort()) {
    if (!f.endsWith(".errors.txt")) continue;
    total++;
    const d = readErrorBaseline(tsgoRules, readFileSync(GO + "/" + suite + "/" + f).toString("latin1")).diagnostics;
    const sorted = d.slice().sort((a: any, b: any) => {
      const fa = a.file?.fileName ?? "", fb = b.file?.fileName ?? "";
      if (fa !== fb) return fa < fb ? -1 : 1;
      if (a.pos !== b.pos) return a.pos - b.pos;
      return a.code - b.code;
    });
    if (sorted.some((x: any, k: number) => x !== d[k])) affected++;
    const firstLocated = d.findIndex((x: any) => x.file !== undefined);
    const lastGlobal = d.findLastIndex((x: any) => x.file === undefined);
    if (lastGlobal >= 0) { if (firstLocated >= 0 && lastGlobal > firstLocated) globalNotFirst++; else globalFirst++; }
  }
}
console.log(JSON.stringify({ total, orderDiffersWithFilePosCode: affected, baselinesWithGlobalDiagnostics: globalFirst + globalNotFirst, globalNotFirst }));
