import { createRequire } from "module";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript");
const cases = [
  "declare function f<T>(x: any): void; declare const y: any;\nf<{ [+1]: number }>(y);",
  "declare function f<T>(x: any): void; declare const y: any;\nf<{ [Symbol.iterator]: number }>(y);",
  "declare function f<T>(x: any): void; declare const y: any;\nf<{ [-1]: number }>(y);",
  "declare const f: any, y: any, a: any, b: any, c: any;\nf<{ [a + b]: c }>(y);",
];
for (const text of cases) {
  const t = new Bun.Transpiler({ loader: "ts", target: "bun" });
  let bun; try { bun = t.transformSync(text).trim(); } catch (e) { bun = "ERR " + String(e?.errors?.[0]?.message ?? e.message).split("\n")[0]; }
  const sf = ts.createSourceFile("a.ts", text, 99, true);
  const tsc = sf.parseDiagnostics.length ? "PARSE-ERR TS" + sf.parseDiagnostics[0].code : ts.transpileModule(text, { compilerOptions: { target: 99, module: 99 } }).outputText.replace(/^"use strict";\n/, "").trim();
  console.log(JSON.stringify(text.split("\n")[1]).padEnd(42), "| bun:", JSON.stringify(bun).padEnd(36), "| tsc:", JSON.stringify(tsc));
}
