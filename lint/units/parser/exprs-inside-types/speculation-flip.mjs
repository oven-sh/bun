import { createRequire } from "module";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript");
const cases = [
  "x < (a = 1) => b > (y);",
  "x < (a: number = 1) => b > (y);",
  "x < ({ a = 1 }) => b > (y);",
  "f<{ [a + b]: c }>(y);",
  "f < { a: b = c } > (y);",
  "new K<(a = 1) => void>();",
  "a ? (b) : (c = 1) => d : e;",
  "x < T extends +1 > (y);",
];
for (const text of cases) {
  const t = new Bun.Transpiler({ loader: "ts", target: "bun" });
  let bun; try { bun = t.transformSync(text).trim(); } catch (e) { bun = "ERR " + String(e?.errors?.[0]?.message ?? e.message).split("\n")[0]; }
  const sf = ts.createSourceFile("a.ts", text, 99, true);
  const tsc = sf.parseDiagnostics.length ? "PARSE-ERR TS" + sf.parseDiagnostics[0].code : ts.transpileModule(text, { compilerOptions: { target: 99, module: 99 } }).outputText.replace(/^"use strict";\n/, "").trim();
  console.log(JSON.stringify(text).padEnd(40), "| bun:", JSON.stringify(bun).padEnd(44), "| tsc:", JSON.stringify(tsc));
}
