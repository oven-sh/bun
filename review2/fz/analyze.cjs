"use strict";
// usage: node analyze.cjs <results.jsonl> [--a node] [--b arm] [--show seed] [--norm name,...] [--list]
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i < 0 ? dflt : argv[i + 1];
};
const A = opt("a", "node"),
  B = opt("b", "arm");
const norms = opt("norm", "").split(",").filter(Boolean);
const { gen } = require(path.resolve(opt("gen", "/tmp/fz/gen.cjs")));
const genOpts = JSON.parse(opt("genopts", "{}"));

const rows = fs
  .readFileSync(argv[0], "utf8")
  .split("\n")
  .filter(Boolean)
  .map(l => JSON.parse(l));
const bySeed = new Map();
for (const r of rows) {
  if (!bySeed.has(r.seed)) bySeed.set(r.seed, {});
  bySeed.get(r.seed)[r.rt] = r;
}

// Normalisations that can be switched on to see which differences a class of noise explains.
function normalise(lines) {
  let out = lines.slice();
  for (const n of norms) {
    if (n === "nomarkers") out = out.filter(l => !/ (tick|micro)#\d+$/.test(l));
    // Streams nothing reads: drop their end/close lines.
    if (n === "noclose") out = out.filter(l => !/^(out|err) close$/.test(l));
    if (n === "noend") out = out.filter(l => !/^(out|err) (end|close)$/.test(l));
    if (n === "nochild") out = out.filter(l => !/^child (exit|close)/.test(l));
    if (n === "sorted") out = out.slice().sort();
  }
  return out;
}
const key = lines => normalise(lines).join("\n");
const canon = r => {
  const counts = new Map();
  for (const t of r.traces) counts.set(key(t), (counts.get(key(t)) || 0) + 1);
  return [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0].split("\n");
};
const generic = l => l.replace(/#\d+/g, "#N").replace(/@\d+/g, "@N").replace(/[A-Za-z]\d+(?=[A-Za-z]\d+|$)/g, "X").replace(/boom-(out|err)-\d+/g, "boom-$1-N");

const show = opt("show", null);
if (show !== null) {
  const s = bySeed.get(+show);
  console.log(JSON.stringify(gen(+show, genOpts)));
  for (const rt of Object.keys(s)) {
    const sets = new Map();
    for (const t of s[rt].traces) sets.set(key(t), (sets.get(key(t)) || 0) + 1);
    for (const [t, c] of sets) console.log(`--- ${rt} x${c}\n${t}`);
    const e = s[rt].stderr.find(x => x);
    if (e && argv.includes("--stderr")) console.log(`--- ${rt} stderr\n${e}`);
  }
  process.exit(0);
}

let same = 0,
  differ = 0,
  unstableA = 0,
  unstableB = 0,
  partial = 0;
const classes = new Map();
const differing = [];
for (const [seed, s] of [...bySeed.entries()].sort((x, y) => x[0] - y[0])) {
  if (!s[A] || !s[B]) continue;
  const sa = new Set(s[A].traces.map(key)),
    sb = new Set(s[B].traces.map(key));
  if (sa.size > 1) unstableA++;
  if (sb.size > 1) unstableB++;
  const inter = [...sa].filter(x => sb.has(x));
  if (inter.length) {
    same++;
    if (sa.size > 1 || sb.size > 1) partial++;
    continue;
  }
  differ++;
  differing.push(seed);
  const ca = canon(s[A]),
    cb = canon(s[B]);
  let i = 0;
  while (i < ca.length && i < cb.length && ca[i] === cb[i]) i++;
  const sig = `${A}: ${generic(ca[i] ?? "<eof>")}  |  ${B}: ${generic(cb[i] ?? "<eof>")}`;
  if (!classes.has(sig)) classes.set(sig, []);
  classes.get(sig).push(seed);
}
console.log(`${A} vs ${B}: seeds ${same + differ}, same ${same} (of which had run-to-run variation ${partial}), differ ${differ}; unstable ${A} ${unstableA}, ${B} ${unstableB}`);
console.log(`classes by first differing line: ${classes.size}`);
for (const [sig, seeds] of [...classes.entries()].sort((x, y) => y[1].length - x[1].length))
  console.log(`${String(seeds.length).padStart(4)}  ${sig}   e.g. ${seeds.slice(0, 6).join(",")}`);
if (argv.includes("--list")) console.log(differing.join(","));
