// Probe: separates the two sources of difference. For each JavaScript unit with JSDoc: are the JSDoc trees themselves equal
// (the conversion of TypeScript's JSDoc nodes), and if they are, is the rest of the tree equal (the reparser pass)?
import fs from "node:fs";
import { importRouteA } from "./difftree2.ts";
import { print } from "./reparse.mjs";
const HEADER = /^(diagnostic\.related|file |externalModuleIndicator|commonJSModuleIndicator|usesUriStyleNodeCoreModules|counts |import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective|diagnostic |jsDiagnostic |jsdocDiagnostic |jsDiagnostic\.related|jsdocDiagnostic\.related)/;
function jsdocTrees(lines: string[]) {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], t = l.trimStart();
    if (!t.startsWith(".jsdoc:") || / SHARED$/.test(l)) continue;
    const m = / f=(0x[0-9a-f]+)/.exec(l);
    if (m && parseInt(m[1]) & 8) continue;
    const ind = l.length - t.length;
    const tree = [t.replace(/ parent=\S+/, "")];
    for (let j = i + 1; j < lines.length; j++) {
      const lj = lines[j];
      if (lj.length - lj.trimStart().length <= ind) break;
      tree.push(lj.slice(ind));
    }
    out.push(tree.join("\n"));
  }
  return out.sort();
}
let units = 0, jsdocEqual = 0, jsdocEqualTreeEqual = 0, jsdocEqualTreeDiffers: string[] = [], jsdocDiffers = 0, jsdocDiffersTreeEqual = 0;
for (const vname of fs.readdirSync("/tmp/tsimp/corpus").sort()) {
  if (!/\.(js|jsx|mjs|cjs)$/.test(vname)) continue;
  const go = fs.readFileSync("/tmp/tsimp/go-out/" + vname + ".tsgo.txt", "utf8").split("\n").filter(l => l.length && !HEADER.test(l));
  if (!go.some(l => l.includes(".jsdoc:"))) continue;
  units++;
  const mine = print(importRouteA(vname, fs.readFileSync("/tmp/tsimp/corpus/" + vname, "utf8")).root);
  const treeEqual = go.join("\n") === mine.join("\n");
  const a = jsdocTrees(go), b = jsdocTrees(mine);
  if (a.join("\n\n") === b.join("\n\n")) { jsdocEqual++; if (treeEqual) jsdocEqualTreeEqual++; else jsdocEqualTreeDiffers.push(vname); }
  else { jsdocDiffers++; if (treeEqual) jsdocDiffersTreeEqual++; }
}
console.log(`JavaScript units with JSDoc ${units}: JSDoc trees equal ${jsdocEqual} (whole tree equal ${jsdocEqualTreeEqual}, whole tree differs ${jsdocEqualTreeDiffers.length}); JSDoc trees differ ${jsdocDiffers} (whole tree equal ${jsdocDiffersTreeEqual})`);
console.log("JSDoc trees equal but whole tree differs:", jsdocEqualTreeDiffers.join(" ") || "-");
