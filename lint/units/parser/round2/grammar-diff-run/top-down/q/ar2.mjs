// <bun> ar2.mjs <file> : A/R under t.ts.plain and t.ts.exp
import { readFileSync } from "node:fs";
const EXP = { compilerOptions: { experimentalDecorators: true } };
const ts = [new Bun.Transpiler({ loader: "ts" }), new Bun.Transpiler({ loader: "ts", tsconfig: EXP })];
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line || line.startsWith("# ")) continue;
  const src = line.replaceAll("\u23ce", "\n");
  console.log(ts.map(t => { try { t.transformSync(src); return "A"; } catch (e) { return "R(" + (e.errors?.[0]?.message ?? e.message) + ")"; } }).join(" / "));
}
