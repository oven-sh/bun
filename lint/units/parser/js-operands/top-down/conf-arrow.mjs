// The file pairs of parserArrowFunctionExpression10..17 (the same text as fileJs.js and as fileTs.ts): what bun's
// JavaScript and TypeScript instantiations say about the JavaScript unit. usage: bun conf-arrow.mjs
import { readFileSync } from "node:fs";
const dir = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases/conformance/parser/ecmascript5/ArrowFunctionExpressions/";
for (let n = 10; n <= 17; n++) {
  const text = readFileSync(`${dir}parserArrowFunctionExpression${n}.ts`, "utf8");
  const unit = text.split(/\/\/ @filename: fileJs\.js\r?\n/)[1].split(/\r?\n\s*\/\/ @filename:/)[0];
  const run = loader => { try { new Bun.Transpiler({ loader, deadCodeElimination: false }).transformSync(unit); return "accepts"; } catch (e) { return "rejects: " + (e.errors ? e.errors[0].message : e.message); } };
  console.log(`${n} ${JSON.stringify(unit.trim())}\n     bun js: ${run("js")}\n     bun ts: ${run("ts")}`);
}
