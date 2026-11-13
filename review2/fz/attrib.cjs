"use strict";
// Attribution of every differing seed to the first normalisation that makes the two runtimes agree.
// usage: node attrib.cjs <results.jsonl> [gen.cjs] [genopts] [A] [B]
const fs = require("fs");
const { HANDLER, MARKER } = require("/tmp/fz/lib.cjs");
const [file, genPath = "/tmp/fz/gen3.cjs", genOptsS = "{}", A = "node", B = "arm"] = process.argv.slice(2);
const { gen } = require(genPath);
const genOpts = JSON.parse(genOptsS);
const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const by = new Map();
for (const r of rows) {
  if (!by.has(r.seed)) by.set(r.seed, {});
  by.get(r.seed)[r.rt] = r.traces;
}

function rle(s) {
  const runs = [];
  for (const m of s.matchAll(/([A-Za-z])(\d+)/g)) {
    if (runs.length && runs[runs.length - 1][0] === m[1]) runs[runs.length - 1][1] += +m[2];
    else runs.push([m[1], +m[2]]);
  }
  return runs.map(r => r[0] + r[1]).join("");
}
const isClose = l => /^(out|err) close$/.test(l);

// Each step takes lines and returns lines (or a key string for the last ones).
const steps = [
  ["identical", (l, sc) => l],
  [
    "G1 ticks and promise jobs that were queued when a fatal error is reported still run (Bun, any callback)",
    (l, sc) => {
      if (sc.ue || !l.includes("process exit 1")) return l;
      let last = -1;
      l.forEach((x, i) => {
        if (HANDLER.test(x)) last = i;
      });
      return l.filter((x, i) => !(i > last && MARKER.test(x)));
    },
  ],
  ["G3 position of a stream's 'close' (Bun: a tick after 'end'/destroy(); Node: after the handle closed)", (l, sc) => l.filter(x => !isClose(x)).concat(l.filter(isClose).sort())],
  [
    "G2 ticks and promise jobs of a listener call that threw into a handler (Node runs them after the next callback, Bun at once)",
    (l, sc) =>
      l.filter(x => {
        const m = /^(out|err) (tick|micro)#(\d+)$/.exec(x);
        return !(m && sc.pipes[m[1]] && sc.pipes[m[1]].actions[+m[3] - 1] === "throw");
      }),
  ],
  ["G4 when 'unhandledRejection' is emitted", (l, sc) => l.filter(x => !x.startsWith("UR ")).concat(l.filter(x => x.startsWith("UR ")).sort())],
  [
    "X1 order across sources only (stdout vs stderr vs the child's 'exit'/'close'); each pipe's own sequence and the outcome agree",
    (l, sc) => {
      const per = {};
      for (const p of ["out", "err"]) per[p] = l.filter(x => x.startsWith(p + " ") || ((x.startsWith("UE ") || x.startsWith("UR ")) && x.includes(`-${p}-`)));
      const rest = l.filter(x => !x.startsWith("out ") && !x.startsWith("err ") && !x.startsWith("UE ") && !x.startsWith("UR ")).sort();
      return [JSON.stringify(per), ...rest];
    },
  ],
  [
    "X2 order within a pipe only; the outcome (bytes, calls, end/close/error, UE/UR, child exit/close, exit status) agrees",
    (l, sc) => {
      const o = { bytes: { out: "", err: "" }, rest: [] };
      for (const x of l) {
        if (x.startsWith("[") || x.startsWith("{")) {
          // the per-pipe JSON of the previous step
          const per = JSON.parse(x);
          for (const p of ["out", "err"])
            for (const y of per[p]) {
              const m = HANDLER.exec(y);
              if (m) {
                o.bytes[p] += m[4];
                o.rest.push(`${p} call`);
              } else if (/^(out|err) (end|close|error .*)$/.test(y) || y.startsWith("UE ") || y.startsWith("UR ")) o.rest.push(y);
            }
        } else o.rest.push(x);
      }
      for (const p of ["out", "err"]) o.bytes[p] = rle(o.bytes[p]);
      o.rest.sort();
      return [JSON.stringify(o)];
    },
  ],
];

const tally = new Map(steps.map(s => [s[0], []]));
tally.set("O outcome differs", []);
let total = 0;
const outcomeSeeds = [];
for (const [seed, s] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
  if (!s[A] || !s[B]) continue;
  total++;
  const sc = gen(seed, genOpts);
  let ta = s[A].map(t => t.slice()),
    tb = s[B].map(t => t.slice());
  let placed = false;
  for (const [name, f] of steps) {
    ta = ta.map(t => f(t, sc));
    tb = tb.map(t => f(t, sc));
    const sa = new Set(ta.map(t => t.join("\n")));
    if (tb.some(t => sa.has(t.join("\n")))) {
      tally.get(name).push(seed);
      placed = true;
      break;
    }
  }
  if (!placed) {
    tally.get("O outcome differs").push(seed);
    outcomeSeeds.push(seed);
  }
}
console.log(`${A} vs ${B}: ${total} seeds. A seed is counted at the first line below that makes some run of ${A} equal some run of ${B}:`);
for (const [name, seeds] of tally) console.log(`${String(seeds.length).padStart(4)}  ${name}${name === "identical" ? "" : "   e.g. " + seeds.slice(0, 10).join(",")}`);
if (process.argv.includes("--lists")) for (const [name, seeds] of tally) if (name !== "identical") console.log(`\n${name}\n${seeds.join(",")}`);
