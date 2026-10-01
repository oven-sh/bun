import fs from "node:fs";
const lines = require("node:zlib").gunzipSync(fs.readFileSync(new URL("../data/diagargs.tsv.gz", import.meta.url))).toString().trim().split("\n");
const byPkg = {};
const examples = {};
let zero=0, total=0;
for (const l of lines) {
  const [loc, fn, callee, msg, args] = l.split("\t");
  const pkg = loc.split("/")[0];
  if (!["checker","binder","ast","scanner","parser","evaluator","core","jsnum"].includes(pkg)) continue;
  total++;
  if (!args) { zero++; continue; }
  for (const a of args.split(" | ")) {
    const m = a.match(/^(SPREAD:[^«]*|[^«]*)(«.*»)?$/);
    let t = m[1];
    const key = pkg + "\t" + t;
    byPkg[key] = (byPkg[key]||0)+1;
    (examples[key] ||= []).push(loc + " " + callee + " " + msg.slice(0,80) + " " + (m[2]||""));
  }
}
console.log("call sites (ported pkgs):", total, "with zero args:", zero);
const rows = Object.entries(byPkg).sort((a,b)=>b[1]-a[1]);
for (const [k,v] of rows) console.log(v + "\t" + k);
console.log("\n=== examples of non-string types ===");
for (const [k] of rows) {
  const t = k.split("\t")[1];
  if (t === "string" || t === "string(const)") continue;
  console.log("## " + k + " (" + byPkg[k] + ")");
  for (const e of examples[k].slice(0, 400)) console.log("   " + e);
}
