// usage: node bundiff.cjs <out of base bun> <out of head bun>: inputs whose "bun" lines differ, by class
const { parse } = require("./parse.cjs");
const a = parse(process.argv[2]), b = parse(process.argv[3]);
const key = r => r.l + "\u0000" + r.s;
const mb = new Map(b.map(r => [key(r), r]));
const cls = r => r.bunKind === "accepts" ? "A" : "R";
let n = 0;
for (const ra of a) {
  const rb = mb.get(key(ra));
  if (!rb) continue;
  const sa = ra.bunKind + "|" + ra.bun.join("|"), sb = rb.bunKind + "|" + rb.bun.join("|");
  if (sa === sb) continue;
  n++;
  const ref = rb.goOk ? "go parses" : rb.go[0] ? "go " + rb.go[0] : ra.tscOk ? "tsc parses" : "tsc " + (ra.tsc[0] ?? "checker " + ra.chk[0]);
  console.log(cls(ra) + ">" + cls(rb) + " " + JSON.stringify(ra.s) + " [" + ra.l + "]\n    base: " + (ra.bun[0] ?? "accepts") + "\n    head: " + (rb.bun[0] ?? "accepts") + "\n    " + ref);
}
console.log(n + " differ");
