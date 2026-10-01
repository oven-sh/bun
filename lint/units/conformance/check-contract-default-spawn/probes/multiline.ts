import { readdirSync, readFileSync } from "node:fs";
const E = new URL("../../error-baseline-format/top-down/", import.meta.url).pathname;
const { tsgoRules } = await import(E + "diagnosticwriter.ts");
const { readErrorBaseline } = await import(E + "reader.ts");
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
let n = 0, withBreak = 0, related = 0, relatedWithFile = 0, relatedNoFile = 0, chainMax = 0, diags = 0, relatedChain = 0;
const names: string[] = [];
const relCodes: Record<string, number> = {};
function walk(d: any, depth: number) { chainMax = Math.max(chainMax, depth); for (const c of d.messageChain) { if (/[\r\n]/.test(c.messageText)) { withBreak++; } walk(c, depth + 1); } }
for (const suite of ["compiler", "conformance"]) {
  for (const f of readdirSync(GO + "/" + suite).sort()) {
    if (!f.endsWith(".errors.txt")) continue;
    n++;
    const text = readFileSync(GO + "/" + suite + "/" + f).toString("latin1");
    const p = readErrorBaseline(tsgoRules, text);
    for (const d of p.diagnostics) {
      diags++;
      if (/[\r\n]/.test(d.messageText)) { withBreak++; names.push(f + ": " + JSON.stringify(d.messageText.slice(0, 150))); }
      walk(d, 0);
      for (const r of d.relatedInformation) {
        related++;
        if (r.file !== undefined) relatedWithFile++; else relatedNoFile++;
        if (r.messageChain.length > 0) relatedChain++;
        if (/[\r\n]/.test(r.messageText)) { withBreak++; names.push(f + ": related: " + JSON.stringify(r.messageText.slice(0, 150))); }
      }
    }
  }
}
console.log(JSON.stringify({ baselines: n, diags, withBreak, related, relatedWithFile, relatedNoFile, relatedChain, chainMax }));
console.log(names.slice(0, 20).join("\n"));
