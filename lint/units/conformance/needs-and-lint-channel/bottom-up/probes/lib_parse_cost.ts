import { readdirSync, readFileSync } from "node:fs";
const dir = "/workspace/ref/typescript-go/internal/bundled/libs/";
const names = readdirSync(dir).filter(n => n.endsWith(".d.ts") && !/webworker|scripthost|decorators\.legacy/.test(n));
const t = new Bun.Transpiler({ loader: "ts" });
let bytes = 0; const texts = names.map(n => { const s = readFileSync(dir + n, "utf8"); bytes += s.length; return s; });
for (let round = 0; round < 3; round++) {
  const t0 = performance.now();
  for (const s of texts) t.transformSync(s);
  console.log("round", round, names.length, "files", bytes, "bytes", (performance.now() - t0).toFixed(1), "ms");
}
