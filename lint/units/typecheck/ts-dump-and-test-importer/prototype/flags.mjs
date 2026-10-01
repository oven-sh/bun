import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/workspace/bun/node_modules/");
const ts = require("typescript");
function dumpEnum(name, e) {
  console.log("== " + name);
  for (const k of Object.keys(e)) {
    if (/^-?\d+$/.test(k)) continue;
    const v = e[k];
    const bits = [];
    for (let i = 0; i < 32; i++) if ((v >>> 0) & (1 << i)) bits.push(i);
    console.log(`  ${k} = ${v} ${bits.length === 1 ? "(1<<" + bits[0] + ")" : "[" + bits.join(",") + "]"}`);
  }
}
dumpEnum("NodeFlags", ts.NodeFlags);
dumpEnum("TokenFlags", ts.TokenFlags);
dumpEnum("ModifierFlags", ts.ModifierFlags);
dumpEnum("ScriptKind", ts.ScriptKind);
dumpEnum("LanguageVariant", ts.LanguageVariant);
dumpEnum("ScriptTarget", ts.ScriptTarget);
dumpEnum("JSDocParsingMode", ts.JSDocParsingMode);
