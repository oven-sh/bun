// node directives-vs-tsc.cjs : the directives of vectors/directives.expected (typescript-go) beside sourceFile.commentDirectives of TypeScript 6.0.2, in UTF-8 byte offsets.
const fs = require("fs");
const path = require("path");
const ts = require(process.env.ORACLE_TYPESCRIPT || "/workspace/bun/node_modules/typescript");
const inputs = JSON.parse(fs.readFileSync(path.join(__dirname, "directives-inputs.json"), "utf8"));
const go = new Map(); let cur = null;
for (const l of fs.readFileSync(path.join(__dirname, "vectors", "directives.expected"), "utf8").split("\n")) { if (l.startsWith("--- ")) { cur = l.slice(4); go.set(cur, []); } else if (l.startsWith("directive ")) go.get(cur).push(l.slice(10)); }
let same = 0, diff = 0;
for (const [name, source] of inputs) {
  const b = i => Buffer.byteLength(source.slice(0, i), "utf8");
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const t = (sf.commentDirectives || []).map(d => `${d.type === 0 ? "ExpectError" : "Ignore"} ${b(d.range.pos)}..${b(d.range.end)}`);
  if (JSON.stringify(t) === JSON.stringify(go.get(name))) same++; else { diff++; console.log(`DIFF ${name} ${JSON.stringify(source)}\n  tsc : ${JSON.stringify(t)}\n  tsgo: ${JSON.stringify(go.get(name))}`); }
}
console.log(`same=${same} diff=${diff} ts=${ts.version}`);
