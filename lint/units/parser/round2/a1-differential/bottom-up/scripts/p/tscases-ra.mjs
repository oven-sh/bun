import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const units = JSON.parse(readFileSync("/tmp/a1bu/p/tscases.json", "utf8"));
const [a, b] = ["base", "head"].map(t => readFileSync(`/tmp/a1bu/runs/tscases.${t}.jsonl`, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)));
const GRAMMARISH = c => (c >= 1000 && c < 2000) || [2369, 2371, 2499, 2500, 5086, 5087, 8020, 17019, 17020, 18016, 18006, 18007, 18010, 18012, 18019, 18024, 2462, 2463, 2452, 7061, 2427, 2457].includes(c);
function verdict(src, tsx, legacy) {
  const kind = tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const fileName = tsx ? "/input.tsx" : "/input.ts";
  const parse = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, false, kind).parseDiagnostics;
  if (parse.length) return { p: parse.map(d => [d.code, d.start, ts.flattenDiagnosticMessageText(d.messageText, " ")]) };
  let file;
  const host = { getSourceFile: (n, lv) => (n === fileName ? (file ??= ts.createSourceFile(n, src, lv, true, kind)) : undefined), getDefaultLibFileName: () => "/lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: f => f === fileName, readFile: f => (f === fileName ? src : undefined), directoryExists: () => true, getDirectories: () => [] };
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve, noLib: true, noResolve: true, types: [], ...(legacy ? { experimentalDecorators: true, emitDecoratorMetadata: true } : {}) };
  try {
    const program = ts.createProgram({ rootNames: [fileName], options, host });
    const sem = program.getSemanticDiagnostics(program.getSourceFile(fileName));
    return { s: sem.filter(d => GRAMMARISH(d.code)).map(d => [d.code, d.start, ts.flattenDiagnosticMessageText(d.messageText, " ")]) };
  } catch (e) { return { s: [[0, 0, "threw " + e.message]] }; }
}
const lineAt = (src, line) => src.split("\n")[line - 1] ?? "";
const rows = [];
for (let i = 0; i < units.length; i++) {
  for (let k = 0; k < 2; k++) {
    const x = a[i][k], y = b[i][k];
    if (!(x[0] === "e" && y[0] !== "e")) continue;
    if (k === 1 && a[i][0][0] === "e" && b[i][0][0] !== "e") continue; // same as plain
    const v = verdict(units[i].src, units[i].tsx, k === 1);
    const e = x[1][0];
    const vs = v.p ? "P:" + [...new Set(v.p.map(d => d[0]))].slice(0, 4).join(",") : v.s.length ? "S:" + [...new Set(v.s.map(d => d[0]))].slice(0, 5).join(",") : "ok";
    rows.push(`${k ? "deco " : "plain"} ${vs.padEnd(22)} ${e[0].padEnd(34)} | ${lineAt(units[i].src, e[1]).trim().slice(0, 90)}   [${units[i].prod.replace(/^(compiler|conformance)\//, "").slice(-60)}]`);
  }
}
console.log(rows.sort().join("\n"));
console.log(rows.length);
