// usage: node rows.cjs <inputs.json> [<lint.tsv>]   prints, for each input, the first parse diagnostic of typescript-go 89d5d5b
// as a row of a Rust table (source, loader, code, start, end, text), or `parses`; with the tsv of the lint probe, a mark:
//   =  the lint parse of be1ebe5295 gives the same code, range and text     ~  same code and range, other text
//   !  other code or range     A  the reference rejects, the lint parse accepts     B  the reference parses, the lint parse rejects
const fs = require("fs");
const { spawnSync } = require("child_process");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const nameOf = l => (l === "dts" ? "input.d.ts" : "input." + (l || "ts"));
const lines = inputs.map((r, id) => JSON.stringify({ id, name: nameOf(r.l), src: r.s })).join("\n") + "\n";
const p = spawnSync("/tmp/rr/parsediag-bu", [], { input: lines, maxBuffer: 1 << 28 });
const go = new Map();
for (const line of String(p.stdout).split("\n")) if (line) { const r = JSON.parse(line); go.set(r.id, r); }
const lint = new Map();
if (process.argv[3]) for (const line of fs.readFileSync(process.argv[3], "utf8").split("\n")) { if (line) { const f = line.split("\t"); lint.set(Number(f[0]), f); } }
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
const lit = s => 'b"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
const loader = l => ({ ts: "Ts", tsx: "Tsx", js: "Js", jsx: "Jsx", dts: "Ts /* .d.ts */" })[l || "ts"];
let group = null;
inputs.forEach((r, id) => {
  if (r.g && r.g !== group) { group = r.g; console.log("// " + group); }
  const g = go.get(id), f = lint.get(id);
  const d = g && g.diags && g.diags[0];
  let mark = "";
  if (f) {
    const ok = f[1] === "ok";
    if (!d) mark = ok ? "=" : "B";
    else if (ok) mark = "A";
    else if (Number(f[4]) === d[0] && Number(f[5]) === d[1] && Number(f[6]) - Number(f[5]) === d[2]) mark = unhex(f[9]) === d[5] ? "=" : "~";
    else mark = "!";
  }
  if (!d) console.log(`${mark} ${lit(r.s)}, Loader::${loader(r.l)}  parses`);
  else console.log(`${mark} (${lit(r.s)}, Loader::${loader(r.l)}, ${d[0]}, ${d[1]}, ${d[1] + d[2]}, ${JSON.stringify(d[5])}),`);
});
