// Lists err("...") expectations of an existing test file whose input tsc parses without a parse diagnostic.
// Usage: bun flip.mjs <test file> <first line> <last line> [--tsx]
import { readFileSync } from "node:fs";
import ts from "/workspace/bun/node_modules/typescript/lib/typescript.js";
const [file, first, last] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const tsx = process.argv.includes("--tsx");
const lines = readFileSync(file, "utf8").split("\n");
const tr = new Bun.Transpiler({ loader: tsx ? "tsx" : "ts" });
let n = 0,
  flips = 0;
for (let i = first - 1; i < Math.min(last, lines.length); i++) {
  const m = lines[i].match(/^\s*(?:err|expectParseError|ts\.expectParseError)\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*,\s*(.*)\);?\s*$/);
  if (!m) continue;
  let code;
  try {
    code = (0, eval)(m[1]);
  } catch {
    continue;
  }
  n++;
  const sf = ts.createSourceFile(tsx ? "a.tsx" : "a.ts", code, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let bun = "OK";
  try {
    tr.transformSync(code);
  } catch (e) {
    bun = "ERR";
  }
  if (sf.parseDiagnostics.length === 0) {
    flips++;
    console.log(`${i + 1}: ${JSON.stringify(code)}  expects ${m[2]}  bun-now=${bun}`);
  }
}
console.log(`checked ${n} err() rows, ${flips} are accepted by tsc's parser`);
