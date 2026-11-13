"use strict";
// Break the R1 oracle's hits down by how the throwing pipe is consumed.
const fs = require("fs");
const { HANDLER, MARKER } = require("/tmp/fz/lib.cjs");
const [file, genPath = "/tmp/fz/gen3.cjs", genOpts = "{}", RTN = "arm"] = process.argv.slice(2);
const { gen } = require(genPath);
const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const by = new Map();
for (const r of rows) { if (!by.has(r.seed)) by.set(r.seed, {}); by.get(r.seed)[r.rt] = r.traces; }
function after(lines, sc) {
  for (let i = 0; i < lines.length; i++) {
    const m = HANDLER.exec(lines[i]);
    if (!m) continue;
    const cfg = sc.pipes[m[1]];
    if (!cfg || cfg.mode === "iter") continue;
    if (cfg.actions[+m[3] - 1] === "throw") return { i, pipe: m[1], k: +m[3], rest: lines.slice(i + 1) };
  }
  return null;
}
const kinds = { again: (l, p) => HANDLER.test(l) && l.startsWith(p + " "), end: (l, p) => l === `${p} end`, childClose: l => l.startsWith("child close"), childExit: l => l.startsWith("child exit"), sibling: (l, p) => (l.startsWith("out ") || l.startsWith("err ")) && !l.startsWith(p + " ") && !MARKER.test(l) && (HANDLER.test(l) || / (end|close)$/.test(l)) };
const table = new Map();
let n = 0;
for (const [seed, s] of by) {
  const sc = gen(seed, JSON.parse(genOpts));
  if (sc.ue) continue;
  const nodeA = s.node.map(t => after(t, sc));
  if (!nodeA.every(Boolean)) continue;
  const runs = s[RTN].map(t => after(t, sc));
  if (!runs.every(Boolean)) continue;
  n++;
  const r0 = runs[0];
  const cfg = sc.pipes[r0.pipe];
  // how the chunk that threw got to the listener
  const pausedBefore = cfg.actions.slice(0, r0.k - 1).some(a => /(^|:)pr:/.test(a) || /(^|:)rr:/.test(a));
  let path;
  if (cfg.mode !== "data") path = `mode ${cfg.mode}`;
  else if (cfg.at === "exit") path = "'data' attached in the child's 'exit'  [residual (c) as documented]";
  else if (["imm", "t25", "t105"].includes(cfg.at)) path = "'data' attached late (setImmediate / timer)";
  else if (pausedBefore) path = "'data' attached at spawn, an earlier call paused or removed the listener";
  else path = "'data' attached at spawn, nothing paused: the chunk comes straight from the read callback";
  const hit = {};
  for (const [k, f] of Object.entries(kinds)) hit[k] = runs.some(r => r.rest.some(l => f(l, r.pipe)));
  if (!table.has(path)) table.set(path, { n: 0, again: 0, end: 0, childClose: 0, childExit: 0, sibling: 0, seeds: {} });
  const t = table.get(path);
  t.n++;
  for (const k of Object.keys(kinds)) if (hit[k]) { t[k]++; (t.seeds[k] ??= []).push(seed); }
}
console.log(`${RTN}: ${n} fatal scenarios. Per delivery path: scenarios in which, after the fatal throw, at least one run shows ...`);
console.log("   n  again   end  child'close'  child'exit'  sibling   path");
for (const [p, t] of [...table.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${String(t.n).padStart(4)} ${String(t.again).padStart(6)} ${String(t.end).padStart(5)} ${String(t.childClose).padStart(13)} ${String(t.childExit).padStart(12)} ${String(t.sibling).padStart(8)}   ${p}`);
  if (process.argv.includes("--seeds")) console.log("        " + JSON.stringify(t.seeds));
}
