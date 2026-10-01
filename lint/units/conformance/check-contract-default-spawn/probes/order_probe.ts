// How often the order of the reference differs from an order by file, position and code alone (research probe).
import { readdirSync, readFileSync } from "node:fs";
const E = new URL("../../error-baseline-format/top-down/", import.meta.url).pathname;
const { tsgoRules } = await import(E + "diagnosticwriter.ts");
const { readErrorBaseline } = await import(E + "reader.ts");
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
let baselines = 0, samePosPairs = 0, endDecides = 0, codeDescending = 0, fileOrderNotByDisplay = 0, dup = 0;
const ex: string[] = [];
const exFile: string[] = [];
for (const suite of ["compiler", "conformance"]) {
  for (const f of readdirSync(GO + "/" + suite).sort()) {
    if (!f.endsWith(".errors.txt")) continue;
    baselines++;
    const p = readErrorBaseline(tsgoRules, readFileSync(GO + "/" + suite + "/" + f).toString("latin1"));
    const d = p.diagnostics;
    let affected = false;
    for (let k = 1; k < d.length; k++) {
      const a = d[k - 1], b = d[k];
      if (a.file === undefined || b.file === undefined) continue;
      if (a.file.fileName !== b.file.fileName) {
        if (!(a.file.fileName < b.file.fileName)) { fileOrderNotByDisplay++; if (exFile.length < 5) exFile.push(f + ": " + a.file.fileName + " before " + b.file.fileName); }
        continue;
      }
      if (a.pos !== b.pos) continue;
      samePosPairs++;
      if (a.end !== b.end) endDecides++;
      if (a.code > b.code) { codeDescending++; affected = true; if (ex.length < 8) ex.push(`${f}: pos ${a.pos}: TS${a.code} (end ${a.end}) before TS${b.code} (end ${b.end})`); }
      if (a.code === b.code && a.end === b.end && a.messageText === b.messageText) dup++;
    }
  }
}
console.log(JSON.stringify({ baselines, samePosPairs, endDecides, codeDescending, fileOrderNotByDisplay, sameCodeEndText: dup }));
console.log(ex.join("\n"));
console.log(exFile.join("\n"));
