"use strict";
const fs = require("fs");
const { HANDLER, MARKER } = require("/tmp/fz/lib.cjs");
const [file, genPath, genOpts = "{}", RTN = "arm"] = process.argv.slice(2);
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
    if (cfg.actions[+m[3] - 1] === "throw") return { pipe: m[1], k: +m[3], rest: lines.slice(i + 1) };
  }
  return null;
}
const T = { n: 0, exitAt: 0 };
const tally = {};
for (const [seed, s] of by) {
  const sc = gen(seed, JSON.parse(genOpts));
  if (sc.ue) continue;
  if (!s.node.map(t => after(t, sc)).every(Boolean)) continue;
  const runs = s[RTN].map(t => after(t, sc));
  if (!runs.every(Boolean)) continue;
  T.n++;
  const p = runs[0].pipe, cfg = sc.pipes[p];
  const inExit = cfg.at === "exit";
  if (inExit) T.exitAt++;
  const f = {
    "same listener called again": runs.some(r => r.rest.some(l => HANDLER.test(l) && l.startsWith(r.pipe + " "))),
    "'end' of that stream": runs.some(r => r.rest.includes(`${r.pipe} end`)),
    "child 'close'": runs.some(r => r.rest.some(l => l.startsWith("child close"))),
    "child 'exit'": runs.some(r => r.rest.some(l => l.startsWith("child exit"))),
    "sibling pipe's listener / 'end' / 'close'": runs.some(r => r.rest.some(l => /^(out|err) /.test(l) && !l.startsWith(r.pipe + " ") && !MARKER.test(l) && (HANDLER.test(l) || / (end|close)$/.test(l)))),
  };
  f["any of these"] = Object.values(f).some(Boolean);
  for (const [k, v] of Object.entries(f)) { tally[k] ??= { in: 0, out: 0, seeds: [] }; if (v) { inExit ? tally[k].in++ : tally[k].out++; if (!inExit) tally[k].seeds.push(seed); } }
}
console.log(`${RTN}: ${T.n} scenarios in which Node dies at a listener's throw; the throwing stream's consumer is attached in the child's 'exit' in ${T.exitAt}, elsewhere in ${T.n - T.exitAt}`);
for (const [k, v] of Object.entries(tally)) console.log(`  ${k}: ${v.in + v.out} scenarios (${v.in} with the consumer attached in 'exit', ${v.out} elsewhere)   elsewhere e.g. ${v.seeds.slice(0, 8).join(",")}`);
