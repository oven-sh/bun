// Probe: the external module indicator computed after the reparser pass against typescript-go's, for JavaScript units.
import fs from "node:fs";
import { importRouteA } from "./difftree2.ts";
let n = 0, same = 0; const bad: string[] = [];
let withJsImport = 0, jsImportIsIndicator = 0;
for (const vname of fs.readdirSync("/tmp/tsimp/corpus").sort()) {
  if (!/\.(js|jsx|mjs|cjs)$/.test(vname)) continue;
  n++;
  const goLines = fs.readFileSync("/tmp/tsimp/go-out/" + vname + ".tsgo.txt", "utf8").split("\n");
  const go = goLines.find(l => l.startsWith("externalModuleIndicator "))!.slice("externalModuleIndicator ".length);
  const { root } = importRouteA(vname, fs.readFileSync("/tmp/tsimp/corpus/" + vname, "utf8"));
  const e = root.externalModuleIndicator;
  const mine = e ? `Kind${e.kind}[${e.pos},${e.end})` : "<nil>";
  if (goLines.some(l => l.includes("KindJSImportDeclaration"))) { withJsImport++; if (go.startsWith("KindJSImportDeclaration")) jsImportIsIndicator++; }
  if (go === mine) same++; else bad.push(`${vname}: go ${go} mine ${mine}`);
}
console.log(`JavaScript units ${n}: indicator equal ${same}, different ${bad.length}; units with a JSImportDeclaration ${withJsImport}, where it is the indicator ${jsImportIsIndicator}`);
for (const b of bad.slice(0, 8)) console.log("  ", b);
