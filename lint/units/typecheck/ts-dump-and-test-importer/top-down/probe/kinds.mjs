import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/workspace/bun/package.json");
const ts = require("typescript");
console.log("ts.version", ts.version);
const ast = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/_scripts/ast.json", "utf8"));
const go = ast.kinds.elements.map(e => typeof e === "string" ? e : e.name).filter(Boolean);
// TS: names by value, skipping markers (First*/Last*)
const tsNames = new Map();
for (const [k, v] of Object.entries(ts.SyntaxKind)) {
  if (typeof v !== "number") continue;
  if (/^(First|Last)/.test(k)) continue;
  if (!tsNames.has(v)) tsNames.set(v, []);
  tsNames.get(v).push(k);
}
const tsByName = new Map();
for (const [v, ns] of tsNames) for (const n of ns) tsByName.set(n, v);
console.log("go kinds", go.length, "ts kinds", tsNames.size, "ts Count", ts.SyntaxKind.Count);
const onlyGo = go.filter(n => !tsByName.has(n));
const goSet = new Set(go);
const onlyTs = [...tsByName.keys()].filter(n => !goSet.has(n));
console.log("only in tsgo:", onlyGo.map(n => n + "=" + go.indexOf(n)));
console.log("only in TS:", onlyTs.map(n => n + "=" + tsByName.get(n)));
let same = 0;
for (let i = 0; i < go.length; i++) if (tsByName.get(go[i]) === i) same++;
console.log("same number:", same);
// multiple names for same value in TS
for (const [v, ns] of tsNames) if (ns.length > 1) console.log("TS multi-name", v, ns);
// first divergence
for (let i = 0; i < go.length; i++) { if (tsByName.get(go[i]) !== i) { console.log("first divergence at go", i, go[i], "ts value", tsByName.get(go[i]), "ts name at i", tsNames.get(i)); break; } }
