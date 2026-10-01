// usage: node firstdiff.cjs out.txt   prints the inputs whose first diagnostic differs between tsc 6.0.2 and typescript-go
const lines = require("node:fs").readFileSync(process.argv[2], "utf8").split("\n");
let cur = null, tsc = null, go = null, n = 0, total = 0;
const flush = () => {
  if (cur === null) return;
  total++;
  if (tsc !== go) { n++; console.log(cur + "\n   tsc " + tsc + "\n   go  " + go); }
};
for (const l of lines) {
  if (l.startsWith("## ")) continue;
  if (!l.startsWith("   ")) { flush(); cur = l; tsc = null; go = null; continue; }
  const m = /^   (tsc|go ) (.*)$/.exec(l);
  if (!m) continue;
  const v = m[2].replace(/^parses; checker .*$/, "parses");
  if (m[1] === "tsc" && tsc === null) tsc = v;
  if (m[1] === "go " && go === null) go = v;
}
flush();
console.log(n + " of " + total + " differ");
