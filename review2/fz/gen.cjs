"use strict";
// seed -> scenario. Deterministic, so node and bun run the same scenario.
function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GAP = 40;
const NAP = 60;

function gen(seed, opts = {}) {
  const r = rng(seed);
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const wpick = pairs => {
    let tot = 0;
    for (const [, w] of pairs) tot += w;
    let x = r() * tot;
    for (const [v, w] of pairs) if ((x -= w) < 0) return v;
    return pairs[pairs.length - 1][0];
  };

  const which = wpick([
    ["out", 5],
    ["err", 2],
    ["both", 3],
  ]);
  const pacing = wpick([
    ["paced", 6],
    ["burst", 4],
  ]);
  const ending = wpick([
    ["linger", 3],
    ["exit", 4],
    ["tail", 2],
    ["hangup", 1],
  ]);
  const nchunks = 1 + Math.floor(r() * 4);
  const code = wpick([
    [0, 4],
    [3, 1],
  ]);
  const ue = r() < 0.6;
  const ur = r() < 0.3;

  // The writer.
  const fds = which === "out" ? ["o"] : which === "err" ? ["e"] : ["o", "e"];
  const tags = { o: "ABCD", e: "abcd" };
  const writer = [];
  // A burst of more than one write is one chunk only if the reader is not reading meanwhile.
  let spawnNap = pacing === "burst" ? NAP : 0;
  let totalBurst = 0;
  for (let i = 0; i < nchunks; i++) {
    const size = wpick([
      [3, 7],
      [40000, opts.big === false ? 0 : 2],
      [65536, opts.big === false ? 0 : 1],
    ]);
    // One read takes a whole burst only if it is at most 64 KiB (libuv's read size).
    const sz = pacing === "burst" && totalBurst + size > 65536 ? 3 : size;
    totalBurst += sz;
    for (const f of fds) writer.push(`${f}${tags[f][i]}:${sz}`);
    if (pacing === "paced" && i < nchunks - 1) writer.push(`s:${GAP}`);
  }
  switch (ending) {
    case "linger":
      writer.push(`s:${GAP * 3}`, `x:${code}`);
      break;
    case "exit":
      writer.push(`x:${code}`);
      break;
    case "tail":
      writer.push("f", `s:${GAP * 2}`);
      for (const f of fds) writer.push(`${f}${f === "o" ? "T" : "t"}:3`);
      writer.push(`s:${GAP}`, "x:0");
      break;
    case "hangup":
      for (const f of fds) writer.push(`c${f}`);
      writer.push(`s:${GAP * 3}`, `x:${code}`);
      break;
  }

  // The consumers.
  let napUsed = spawnNap > 0;
  const consumer = () => {
    const mode = wpick([
      ["data", 10],
      ["readable", 2],
      ["readable-then-data", 2],
      ["readable+data", 1],
      ["paused", 2],
      ["iter", 1],
      ["resume", 0.5],
      ["none", 0.5],
    ]);
    const at = wpick([
      ["sync", 8],
      ["tick", 1],
      ["imm", 1],
      ["spawn", 1],
      ["t20", 2],
      ["t100", 1],
      ["exit", 2],
    ]);
    const second = pick(["tick", "micro", "imm", "t5", "t100"]);
    const simple = () =>
      wpick([
        ["none", 6],
        ["pr:imm", 1.5],
        ["pr:tick", 1.5],
        ["pr:micro", 1.5],
        ["pr:t5", 0.7],
        ["pr:t100", 0.7],
        ["throw", 4],
        ["rr:sync", 0.5],
        ["rr:tick", 1],
        ["rr:micro", 1.5],
        ["rr:imm", 1],
        ["read:all", 0.7],
        ["read:1", 0.7],
        ["read:100000", 0.4],
        ["destroy", 0.8],
        ["destroy:err", 0.5],
        ["kill", 0.3],
      ]);
    const actions = [];
    for (let i = 0; i < 5; i++) {
      let a = simple();
      const x = r();
      if (x < 0.12) a = `async:${pick(["micro", "tick", "imm"])}:${a}`;
      else if (x < 0.17 && !napUsed) {
        a = `nap:${NAP}`;
        napUsed = true;
      }
      actions.push(a);
    }
    return { mode, at, second, actions };
  };

  const pipes = {};
  if (which !== "err") pipes.out = consumer();
  if (which !== "out") pipes.err = consumer();

  let stdio;
  if (which === "out")
    stdio = wpick([
      [["ignore", "pipe", "ignore"], 3],
      [["ignore", "pipe", "pipe"], 3],
      [["ignore", "pipe"], 2],
      [["pipe", "pipe", "pipe"], 2],
    ]);
  else if (which === "err")
    stdio = wpick([
      [["ignore", "ignore", "pipe"], 3],
      [["ignore", "pipe", "pipe"], 3],
      [["pipe", "pipe", "pipe"], 2],
    ]);
  else
    stdio = wpick([
      [["ignore", "pipe", "pipe"], 4],
      [["ignore", "pipe"], 2],
      [["pipe", "pipe", "pipe"], 2],
    ]);

  return { seed, stdio, ue, ur, markers: r() < 0.8, spawnNap, writer, pipes, meta: { which, pacing, ending, nchunks } };
}

module.exports = { gen };
if (require.main === module) {
  const s = +process.argv[2];
  console.log(JSON.stringify(gen(s), null, 1));
}
