// Early errors: the same expression E (a) inside type syntax for tsc: `let g: (a = E) => void` and `type A = { [E]: 1 }`,
// (b) as a real default value for the Bun binary that runs this script: `let g = (a = E) => 0`.
// Shows where Bun's expression or statement parser reports an error and the parser of tsc 6.0.2 does not.
// usage: <bun> early.cjs <file with one expression per line> [module|script]
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const asModule = process.argv[3] !== "script";
const tail = asModule ? "\nexport {};" : "";
function tsc(src) {
  const sf = ts.createSourceFile("input.ts", src, ts.ScriptTarget.ESNext, true);
  const parse = sf.parseDiagnostics.map(d => "TS" + d.code);
  let check = [];
  if (!parse.length) {
    const options = { noLib: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, noEmit: true, types: [], experimentalDecorators: true };
    const host = ts.createCompilerHost(options);
    host.getSourceFile = f => (f === "input.ts" ? sf : undefined); host.fileExists = f => f === "input.ts"; host.readFile = f => (f === "input.ts" ? src : undefined);
    const prog = ts.createProgram(["input.ts"], options, host);
    check = [...new Set(prog.getSemanticDiagnostics(sf).filter(d => d.code < 2000 || (d.code >= 17000 && d.code < 19000)).map(d => "TS" + d.code))];
  }
  return { parse, check };
}
function bun(src) {
  try { new Bun.Transpiler({ loader: "ts" }).transformSync(src); return "ok"; }
  catch (e) { const errs = e && e.errors ? e.errors : [e]; return "REJ: " + String(errs[0].message || errs[0]).slice(0, 70); }
}
for (const raw of fs.readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!raw.trim() || raw.startsWith("#")) { if (raw.startsWith("#")) console.log("\n" + raw); continue; }
  const E = raw.replace(/\\n/g, "\n");
  const t1 = tsc(`let g: (a = ${E}) => void;${tail}`);
  const t2 = tsc(`type A = { [${E}]: 1 };${tail}`);
  const b = bun(`let g = (a = ${E}) => 0;${tail}`);
  const f = x => (x.parse.length ? "PARSE " + x.parse.slice(0, 3).join(",") : "clean" + (x.check.length ? " (checker " + x.check.slice(0, 3).join(",") + ")" : ""));
  const mark = !t1.parse.length && b !== "ok" ? "BUN-ONLY" : t1.parse.length && b === "ok" ? "TSC-ONLY" : "";
  console.log(`${mark.padEnd(9)}| ${raw}\n          tsc initializer: ${f(t1)} | tsc computed name: ${f(t2)}\n          bun real default value: ${b}`);
}
