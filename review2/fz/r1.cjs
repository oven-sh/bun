"use strict";
// R1 oracle: in a scenario with no 'uncaughtException' handler, what does a runtime still run after the first
// listener call that throws synchronously? Node runs nothing (that is checked too).
// usage: node r1.cjs <results.jsonl> [gen.cjs] [genopts-json] [rt]
const fs = require("fs");
const { HANDLER, MARKER } = require("/tmp/fz/lib.cjs");
const [file, genPath = "/tmp/fz/gen3.cjs", genOpts = "{}", RTN = "arm"] = process.argv.slice(2);
const { gen } = require(genPath);
const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const by = new Map();
for (const r of rows) {
  if (!by.has(r.seed)) by.set(r.seed, {});
  by.get(r.seed)[r.rt] = r.traces;
}
function after(lines, sc) {
  // index of the first handler line whose action is a synchronous throw that nothing catches
  for (let i = 0; i < lines.length; i++) {
    const m = HANDLER.exec(lines[i]);
    if (!m) continue;
    const cfg = sc.pipes[m[1]];
    if (!cfg || cfg.mode === "iter") continue;
    if (cfg.actions[+m[3] - 1] === "throw") return { i, pipe: m[1], k: +m[3], via: m[2], rest: lines.slice(i + 1) };
  }
  return null;
}
function classify(rest, pipe) {
  const c = new Set();
  for (const l of rest) {
    if (MARKER.test(l) || l.startsWith("process exit") || l.startsWith("status")) continue;
    const other = pipe === "out" ? "err" : "out";
    if (l === "TIMEOUT") c.add("TIMEOUT");
    else if (HANDLER.test(l)) c.add(l.startsWith(pipe + " ") ? "same pipe: listener called again" : "sibling pipe: listener called");
    else if (l === `${pipe} end`) c.add("same pipe: 'end'");
    else if (l === `${pipe} close`) c.add("same pipe: 'close'");
    else if (l === `${other} end` || l === `${other} close`) c.add("sibling pipe: 'end'/'close'");
    else if (l.startsWith("child exit")) c.add("child 'exit'");
    else if (l.startsWith("child close")) c.add("child 'close'");
    else if (l.startsWith("UE") || l.startsWith("UR")) c.add("UE/UR handler");
    else c.add("other callbacks (immediate, timer, tick, promise job)");
  }
  return c;
}
let fatalSeeds = 0, clean = 0, dirtyAll = 0, dirtyAny = 0, nodeDirty = 0, statusNot1 = 0;
const tally = new Map(), examples = new Map(), combos = new Map();
for (const [seed, s] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
  const sc = gen(seed, JSON.parse(genOpts));
  if (sc.ue) continue;
  const nodeA = s.node.map(t => after(t, sc));
  if (!nodeA.every(Boolean)) continue; // Node never reached a fatal throw in this scenario
  // Node must stop at the throw
  if (s.node.some((t, j) => classify(nodeA[j].rest, nodeA[j].pipe).size > 0)) { nodeDirty++; continue; }
  const runs = s[RTN].map(t => after(t, sc));
  if (!runs.every(Boolean)) continue; // the runtime did not reach the same throw (another difference)
  fatalSeeds++;
  const sets = runs.map(r => classify(r.rest, r.pipe));
  const any = sets.some(x => x.size > 0), all = sets.every(x => x.size > 0);
  if (s[RTN].some(t => !t.includes("status 1 null"))) statusNot1++;
  if (!any) { clean++; continue; }
  dirtyAny++;
  if (all) dirtyAll++;
  const union = new Set(sets.flatMap(x => [...x]));
  for (const k of union) {
    tally.set(k, (tally.get(k) || 0) + 1);
    if (!examples.has(k)) examples.set(k, []);
    examples.get(k).push(seed);
  }
  const combo = [...union].sort().join(" + ");
  combos.set(combo, (combos.get(combo) || []).concat(seed));
}
console.log(`${RTN}: scenarios where Node dies at a listener's throw and ${RTN} reaches the same throw: ${fatalSeeds}`);
console.log(`  nothing but the exit follows in every run: ${clean}`);
console.log(`  something follows in at least one run: ${dirtyAny} (in every run: ${dirtyAll}); exit status not 1 in some run: ${statusNot1}; (Node itself ran something after: ${nodeDirty})`);
for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}   e.g. ${examples.get(k).slice(0, 8).join(",")}`);
console.log("  by combination:");
for (const [k, v] of [...combos.entries()].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(v.length).padStart(4)}  ${k}   e.g. ${v.slice(0, 6).join(",")}`);
