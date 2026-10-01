// Probe: prints the first differences between the route A tree and typescript-go's tree for one unit.
import fs from "node:fs";
import { importRouteA } from "./difftree2.ts";
import { print } from "./reparse.mjs";
const vname = process.argv[2];
const ctxLines = Number(process.argv[3] ?? 6);
const HEADER = /^(diagnostic\.related|file |externalModuleIndicator|commonJSModuleIndicator|usesUriStyleNodeCoreModules|counts |import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective|diagnostic |jsDiagnostic |jsdocDiagnostic |jsDiagnostic\.related|jsdocDiagnostic\.related)/;
const raw = fs.readFileSync((process.env.CORPUS ?? "/tmp/tsimp/corpus") + "/" + vname, "utf8");
const go = fs.readFileSync((process.env.GOOUT ?? "/tmp/tsimp/go-out") + "/" + vname + ".tsgo.txt", "utf8").split("\n").filter(l => l.length && !HEADER.test(l));
const mine = print(importRouteA(vname, raw).root);
fs.writeFileSync("/tmp/jsr/show.go.txt", go.join("\n") + "\n");
fs.writeFileSync("/tmp/jsr/show.mine.txt", mine.join("\n") + "\n");
const MASK = process.env.MASK ?? "comments";
function mask(lines: string[]) {
  if (MASK !== "comments") return lines;
  return lines.map(l => {
    if (/^\s*\.Comment: list \[/.test(l)) return l.replace(/\[-?\d+,-?\d+\)/, "[_,_)");
    if (/Kind(JSDocText|JSDocLink|JSDocLinkCode|JSDocLinkPlain) \[/.test(l)) return l.replace(/\[-?\d+,-?\d+\)/, "[_,_)").replace(/ text=".*"$/, " text=_");
    return l;
  });
}
{ const a = [...mask(go)], b = [...mask(mine)]; go.length = 0; go.push(...a); mine.length = 0; mine.push(...b); }
let i = 0;
while (i < go.length && i < mine.length && go[i] === mine[i]) i++;
if (i === go.length && i === mine.length) console.log("identical", go.length, "lines");
else {
  console.log(`first difference at line ${i + 1}`);
  for (let k = Math.max(0, i - ctxLines); k < i; k++) console.log("   " + go[k]);
  for (let k = i; k < Math.min(go.length, i + ctxLines); k++) console.log("go " + go[k]);
  for (let k = i; k < Math.min(mine.length, i + ctxLines); k++) console.log("ts " + mine[k]);
}
