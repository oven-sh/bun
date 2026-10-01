// Diagnostics of one baseline that tie on file, start, end, code and category: what would order them.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Diagnostic, flattenDiagnosticMessage, tsgoRules } from "./diagnosticwriter";
import { readErrorBaseline } from "./reader";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const rules = tsgoRules;
let baselines = 0, withTie = 0, pairs = 0, textAgrees = 0, textDisagrees = 0, sameText = 0, posTieOnly = 0, endTie = 0;
const examples: string[] = [];
const chainSize = (c: Diagnostic[]): number => c.length + c.reduce((n, x) => n + chainSize(x.messageChain), 0);
for (const suite of ["compiler", "conformance"]) {
  for (const f of readdirSync(join(GO, suite)).sort()) {
    if (!f.endsWith(".errors.txt")) continue;
    baselines++;
    const parsed = readErrorBaseline(rules, rules.model.fromBytes(readFileSync(join(GO, suite, f))));
    let tie = false;
    const d = parsed.diagnostics;
    for (let k = 1; k < d.length; k++) {
      const a = d[k - 1], b = d[k];
      if (a.file === undefined || b.file === undefined || a.file !== b.file) continue;
      if (a.pos === b.pos) posTieOnly++;
      if (a.pos === b.pos && a.end === b.end) endTie++;
      if (a.pos !== b.pos || a.end !== b.end || a.code !== b.code || a.category !== b.category) continue;
      tie = true;
      pairs++;
      const ta = a.messageText, tb = b.messageText;
      if (ta === tb) {
        sameText++;
        const fa = flattenDiagnosticMessage(a, "\n"), fb = flattenDiagnosticMessage(b, "\n");
        if (examples.length < 12) examples.push(`${f}: same head text, chain sizes ${chainSize(a.messageChain)} and ${chainSize(b.messageChain)}, related ${a.relatedInformation.length} and ${b.relatedInformation.length}, whole text ${fa === fb ? "equal" : fa < fb ? "ascending" : "descending"}`);
      } else if (ta < tb) textAgrees++;
      else {
        textDisagrees++;
        if (examples.length < 12) examples.push(`${f}: text descends: ${JSON.stringify(ta.slice(0, 80))} before ${JSON.stringify(tb.slice(0, 80))}`);
      }
    }
    if (tie) withTie++;
  }
}
console.log({ baselines, withTie, pairs, textAgrees, textDisagrees, sameText, posTieOnly, endTie });
for (const x of examples) console.log("  " + x);
