import fs from "node:fs";
import path from "node:path";
const roots = ["/workspace/ref/typescript-go/testdata/baselines/reference/submodule", "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference"];
function* walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (e.name.endsWith(".errors.txt")) yield p; } }
for (const root of roots) {
  let files = 0, withAdj = 0, adjPairs = 0, big = 0, adjInBig = 0; const ex = [];
  for (const p of walk(root)) {
    files++;
    const text = fs.readFileSync(p, "latin1");
    const lines = text.split(/\r?\n/);
    const heads = [];
    for (const l of lines) {
      if (l === "" ) break;
      if (/^\s/.test(l)) { if (heads.length) heads[heads.length - 1].chain.push(l); continue; }
      heads.push({ head: l, chain: [] });
    }
    if (heads.length > 12) big++;
    let found = false;
    for (let i = 1; i < heads.length; i++) {
      if (heads[i].head === heads[i - 1].head && heads[i].chain.length > 0 && heads[i].chain.length === heads[i-1].chain.length && heads[i].chain.join("\n") !== heads[i - 1].chain.join("\n")) {
        adjPairs++; found = true; if (ex.length < 6) ex.push([path.relative(root, p), heads.length, heads[i].head.slice(0, 110)]);
      }
    }
    if (found) { withAdj++; if (heads.length > 12) adjInBig++; }
  }
  console.log(root, { files, moreThan12: big, filesWithSameHeadDifferentChain: withAdj, pairs: adjPairs, thoseWithMoreThan12: adjInBig });
  for (const e of ex) console.log("   ", e.join(" | "));
}
