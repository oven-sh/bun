import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/workspace/bun/package.json");
const ts = require("typescript");
function goConsts(file, prefix) {
  const src = fs.readFileSync(file, "utf8");
  const out = new Map();
  for (const m of src.matchAll(new RegExp("^\\s*" + prefix + "(\\w+)\\s+(?:\\w+\\s+)?=\\s*1 << (\\d+)", "gm"))) out.set(m[1], 2 ** Number(m[2]));
  return out;
}
function cmp(label, tsEnum, go) {
  console.log("=== " + label + " ===");
  const tsSingle = new Map();
  for (const [k, v] of Object.entries(tsEnum)) {
    if (typeof v !== "number") continue;
    if (v !== 0 && (v & (v - 1)) === 0 || v === -2147483648) { if(!tsSingle.has(k)) tsSingle.set(k, v >>> 0); }
  }
  const names = new Set([...tsSingle.keys(), ...go.keys()]);
  for (const n of names) {
    const a = tsSingle.get(n), b = go.get(n);
    const bit = x => x === undefined ? "-" : String(Math.log2(x));
    console.log(`${n.padEnd(40)} ts=${bit(a).padStart(3)} go=${bit(b).padStart(3)} ${a === b ? "same" : (a === undefined ? "GO-ONLY" : b === undefined ? "TS-ONLY" : "MOVED")}`);
  }
}
cmp("NodeFlags", ts.NodeFlags, goConsts("/workspace/ref/typescript-go/internal/ast/nodeflags.go", "NodeFlags"));
cmp("ModifierFlags", ts.ModifierFlags, goConsts("/workspace/ref/typescript-go/internal/ast/modifierflags.go", "ModifierFlags"));
cmp("TokenFlags", ts.TokenFlags, goConsts("/workspace/ref/typescript-go/internal/ast/tokenflags.go", "TokenFlags"));
