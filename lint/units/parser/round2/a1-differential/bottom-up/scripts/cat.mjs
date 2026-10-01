import { createRequire } from "node:module";
import { whole } from "./tsc.mjs";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
for (const src of process.argv.slice(2)) {
  const { sem } = whole(src);
  console.log(JSON.stringify(src), sem.map(d => `TS${d.code}:${ts.DiagnosticCategory[d.category]}`).join(" ") || "-");
}
