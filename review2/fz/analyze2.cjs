"use strict";
// Layered comparison of traces.
// usage: node analyze2.cjs <results.jsonl> [--a node] [--b arm] [--gen gen2.cjs] [--genopts '{}'] [--raw] [--list L0]
//   L0 outcome, order-insensitive: bytes per pipe, end/close/error seen, UE/UR, child exit/close, exit status, timeout
//   L1 + order of each pipe's own lines (data, ticks, promise jobs, resume, re-add, end), 'close' left out
//   L2 + order across pipes and the child's 'exit'/'close', stream 'close' left out
//   L3 every line
// A seed differs at a layer if no run of A equals any run of B at that layer.
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i < 0 ? dflt : argv[i + 1];
};
const A = opt("a", "node"),
  B = opt("b", "arm");
const RAW = argv.includes("--raw");
const { gen } = require(path.resolve(opt("gen", "/tmp/fz/gen2.cjs")));
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

const HANDLER = /^(out|err) (data|read|iter)#(\d+) (.*)$/;
const MARKER = /^(out|err) (tick|micro)#\d+$/;

// Bun runs the ticks and promise jobs that are queued when a fatal error is reported; Node runs nothing. General, so
// those marker lines are dropped (unless --raw). Other lines after the fatal report stay.
function prep(lines, sc) {
  if (RAW) return lines;
  if (sc.ue || !lines.includes("process exit 1")) return lines;
  let last = -1;
  lines.forEach((l, i) => {
    if (HANDLER.test(l)) last = i;
  });
  return lines.filter((l, i) => !(i > last && MARKER.test(l)));
}

function rle(s) {
  // merge "A3" "A2B1" ... into one run-length string
  const runs = [];
  for (const m of s.matchAll(/([A-Za-z])(\d+)/g)) {
    if (runs.length && runs[runs.length - 1][0] === m[1]) runs[runs.length - 1][1] += +m[2];
    else runs.push([m[1], +m[2]]);
  }
  return runs.map(r => r[0] + r[1]).join("");
}

function layers(lines0, sc) {
  const lines = prep(lines0, sc);
  const pp = () => ({ out: 0, err: 0 });
  const o = { bytes: { out: "", err: "" }, calls: pp(), end: pp(), close: pp(), error: { out: "", err: "" }, ue: [], ur: [], childExit: "", childClose: "", procExit: "", status: "" };
  for (const l of lines) {
    let m;
    if ((m = HANDLER.exec(l))) {
      o.bytes[m[1]] = (o.bytes[m[1]] || "") + m[4];
      o.calls[m[1]] = (o.calls[m[1]] || 0) + 1;
    } else if ((m = /^(out|err) end$/.exec(l))) o.end[m[1]] = (o.end[m[1]] || 0) + 1;
    else if ((m = /^(out|err) close$/.exec(l))) o.close[m[1]] = (o.close[m[1]] || 0) + 1;
    else if ((m = /^(out|err) error (.*)$/.exec(l))) o.error[m[1]] = (o.error[m[1]] || "") + m[2] + ";";
    else if (l.startsWith("UE ")) o.ue.push(l);
    else if (l.startsWith("UR ")) o.ur.push(l);
    else if (l.startsWith("child exit")) o.childExit += l;
    else if (l.startsWith("child close")) o.childClose += l;
    else if (l.startsWith("process exit")) o.procExit += l;
    else if (l.startsWith("status") || l === "TIMEOUT") o.status = l;
  }
  for (const p of Object.keys(o.bytes)) o.bytes[p] = rle(o.bytes[p]);
  o.ue.sort();
  o.ur.sort();
  const L0 = JSON.stringify(o);
  const per = {};
  for (const p of ["out", "err"]) per[p] = lines.filter(l => (l.startsWith(p + " ") && l !== p + " close") || ((l.startsWith("UE ") || l.startsWith("UR ")) && l.includes(`-${p}-`)));
  const L1 = L0 + "\n" + JSON.stringify(per);
  const L2 = L0 + "\n" + lines.filter(l => !/^(out|err) close$/.test(l)).join("\n");
  const L3 = lines.join("\n");
  return { L0, L1, L2, L3, o, per, lines };
}

const generic = l =>
  (l ?? "<nothing>")
    .replace(/#\d+/g, "#N")
    .replace(/@\d+/g, "@N")
    .replace(/([A-Za-z]\d+)+$/g, "X")
    .replace(/boom-(out|err)-\d+/g, "boom-$1-N")
    .replace(/destroyed-(out|err)-\d+/g, "destroyed-$1-N");

const LAYERS = ["L0", "L1", "L2", "L3"];
const counts = { L0: 0, L1: 0, L2: 0, L3: 0 };
const firstLayer = { L0: [], L1: [], L2: [], L3: [] };
const classes = { L0: new Map(), L1: new Map(), L2: new Map(), L3: new Map() };
let total = 0;
const info = new Map();
for (const [seed, s] of [...bySeed.entries()].sort((x, y) => x[0] - y[0])) {
  if (!s[A] || !s[B]) continue;
  total++;
  const sc = gen(seed, genOpts);
  const la = s[A].traces.map(t => layers(t, sc)),
    lb = s[B].traces.map(t => layers(t, sc));
  let first = null;
  for (const L of LAYERS) {
    const sa = new Set(la.map(x => x[L]));
    const differs = !lb.some(x => sa.has(x[L]));
    if (differs) {
      counts[L]++;
      if (!first) first = L;
    }
  }
  if (!first) continue;
  firstLayer[first].push(seed);
  // signature
  const a = la[0],
    b = lb[0];
  let sig;
  if (first === "L0") {
    const diffs = [];
    for (const k of Object.keys(a.o)) {
      const x = JSON.stringify(a.o[k]),
        y = JSON.stringify(b.o[k]);
      if (x !== y) diffs.push(k);
    }
    sig = diffs.join("+");
    if (b.o.status === "TIMEOUT") sig = "TIMEOUT(" + B + ") " + sig;
    if (a.o.status === "TIMEOUT") sig = "TIMEOUT(" + A + ") " + sig;
  } else {
    let x, y;
    if (first === "L1") {
      const p = JSON.stringify(a.per.out) !== JSON.stringify(b.per.out) ? "out" : "err";
      x = a.per[p];
      y = b.per[p];
    } else {
      x = first === "L2" ? a.lines.filter(l => !/^(out|err) close$/.test(l)) : a.lines;
      y = first === "L2" ? b.lines.filter(l => !/^(out|err) close$/.test(l)) : b.lines;
    }
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i++;
    sig = `${generic(x[i])} | ${generic(y[i])}`.replace(/\b(out|err)\b/g, "P");
  }
  if (!classes[first].has(sig)) classes[first].set(sig, []);
  classes[first].get(sig).push(seed);
  info.set(seed, first);
}
console.log(`${A} vs ${B}: ${total} seeds${RAW ? " (raw)" : " (ticks and promise jobs after a fatal report dropped)"}`);
console.log(`differ at L0 (outcome) ${counts.L0}, L1 (+per-pipe order) ${counts.L1}, L2 (+cross-source order) ${counts.L2}, L3 (+stream 'close' position) ${counts.L3}`);
for (const L of LAYERS) {
  console.log(`\n== first differing layer ${L}: ${firstLayer[L].length} seeds, ${classes[L].size} signatures`);
  for (const [sig, seeds] of [...classes[L].entries()].sort((x, y) => y[1].length - x[1].length)) console.log(`${String(seeds.length).padStart(4)}  ${sig}    e.g. ${seeds.slice(0, 8).join(",")}`);
}
const list = opt("list", null);
if (list) console.log("\n" + firstLayer[list].join(","));
