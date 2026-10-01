// For every A>A source of the small corpus: the reading of tsc (a call with type arguments, or a comparison), of the parse without lint, of the lint parse.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const a = JSON.parse(require("node:fs").readFileSync("analysis.small.json", "utf8"));
const rows = [];
for (const s of a["A>A all"]) {
  const file = ts.createSourceFile("a.ts", s.src, { languageVersion: ts.ScriptTarget.ESNext }, false, ts.ScriptKind.TS);
  const emit = ts.transpileModule(s.src, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, experimentalDecorators: true } }).outputText.replace('"use strict";\n', "");
  const squash = text => text.replace(/[\s();]/g, "").replace(/'/g, '"').replace(/,}/g, "}");
  const n = s.base[1], l = s.next[1];
  const read = text => (/^f\(x\)/.test(text.trim()) ? "call" : /^f\s*</.test(text.trim()) ? "compare" : "other");
  const first = file.statements[0];
  const tsc = first.kind === ts.SyntaxKind.ExpressionStatement ? (first.expression.kind === ts.SyntaxKind.CallExpression ? "call" : "compare") : "other";
  rows.push({ src: s.src, diagnostics: file.parseDiagnostics.map(d => d.code), tsc, normal: read(n), lint: read(l), lintIsTsc: tsc === "other" ? squash(l) === squash(emit) : read(l) === tsc, normalIsTsc: tsc === "other" ? squash(n) === squash(emit) : read(n) === tsc, emit, n, l });
}
const tally = {};
for (const r of rows) {
  const key = `tsc ${r.diagnostics.length ? "rejects (" + r.diagnostics[0] + ")" : "accepts"}; lint ${r.lintIsTsc ? "reads as tsc" : "reads otherwise"}; normal ${r.normalIsTsc ? "reads as tsc" : "reads otherwise"}`;
  (tally[key] ??= []).push(r.src);
}
for (const [key, list] of Object.entries(tally)) console.log(String(list.length).padStart(3), key, "\n      ", list.map(x => JSON.stringify(x)).join("  "));
for (const r of rows) if (r.tsc === "other") console.log("OTHER", JSON.stringify(r.src), "\n   tsc ", JSON.stringify(r.emit).slice(0, 100), "\n   N   ", JSON.stringify(r.n).slice(0, 100), "\n   L   ", JSON.stringify(r.l).slice(0, 100));
