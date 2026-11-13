"use strict";
// Greedy reduction of differing scenarios. For each seed: simplify the scenario while Node and the other runtime
// still differ at the given level ("X2": beyond cross-source order; "O": outcome; "any": any difference after G1-G4).
// usage: node reduce.cjs <level> <out.jsonl> --seeds a,b,c [--gen gen3.cjs] [--b arm] [--par 4] [--k 2]
const fs = require("fs");
const { RT, runK, HANDLER, MARKER } = require("/tmp/fz/lib.cjs");
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i < 0 ? d : argv[i + 1];
};
const level = argv[0],
  outFile = argv[1];
const { gen } = require(opt("gen", "/tmp/fz/gen3.cjs"));
const Bn = opt("b", "arm");
const K = +opt("k", 2);
const PAR = +opt("par", 4);
const seeds = opt("seeds", "").split(",").filter(Boolean).map(Number);
const GAP = 40,
  NAP = 60;

function rle(s) {
  const runs = [];
  for (const m of s.matchAll(/([A-Za-z])(\d+)/g)) {
    if (runs.length && runs[runs.length - 1][0] === m[1]) runs[runs.length - 1][1] += +m[2];
    else runs.push([m[1], +m[2]]);
  }
  return runs.map(r => r[0] + r[1]).join("");
}
const isClose = l => /^(out|err) close$/.test(l);
function norm(l, sc, lvl) {
  // G1
  if (!sc.ue && l.includes("process exit 1")) {
    let last = -1;
    l.forEach((x, i) => {
      if (HANDLER.test(x)) last = i;
    });
    l = l.filter((x, i) => !(i > last && MARKER.test(x)));
  }
  // G3
  l = l.filter(x => !isClose(x)).concat(l.filter(isClose).sort());
  // G2
  l = l.filter(x => {
    const m = /^(out|err) (tick|micro)#(\d+)$/.exec(x);
    return !(m && sc.pipes[m[1]] && sc.pipes[m[1]].actions[+m[3] - 1] === "throw");
  });
  // G4
  l = l.filter(x => !x.startsWith("UR ")).concat(l.filter(x => x.startsWith("UR ")).sort());
  if (lvl === "any") return l.join("\n");
  // X1
  const per = {};
  for (const p of ["out", "err"]) per[p] = l.filter(x => x.startsWith(p + " ") || ((x.startsWith("UE ") || x.startsWith("UR ")) && x.includes(`-${p}-`)));
  const rest = l.filter(x => !x.startsWith("out ") && !x.startsWith("err ") && !x.startsWith("UE ") && !x.startsWith("UR ")).sort();
  if (lvl === "X2") return JSON.stringify(per) + "\n" + rest.join("\n");
  // O
  const o = { bytes: { out: "", err: "" }, rest: rest.slice() };
  for (const p of ["out", "err"])
    for (const y of per[p]) {
      const m = HANDLER.exec(y);
      if (m) {
        o.bytes[p] += m[4];
        o.rest.push(`${p} call`);
      } else if (/^(out|err) (end|close|error .*)$/.test(y) || y.startsWith("UE ") || y.startsWith("UR ")) o.rest.push(y);
    }
  for (const p of ["out", "err"]) o.bytes[p] = rle(o.bytes[p]);
  o.rest.sort();
  return JSON.stringify(o);
}

// structured writer <-> ops
function parseWriter(sc) {
  const fds = [];
  if (sc.writer.some(w => /^o[A-D]:/.test(w))) fds.push("o");
  if (sc.writer.some(w => /^e[a-d]:/.test(w))) fds.push("e");
  const first = fds[0] === "o" ? /^o[A-D]:(\d+)$/ : /^e[a-d]:(\d+)$/;
  const sizes = sc.writer.map(w => first.exec(w)).filter(Boolean).map(m => +m[1]);
  const x = sc.writer.filter(w => w.startsWith("x:"));
  return { fds, sizes, pacing: sc.meta.pacing, ending: sc.meta.ending, code: sc.meta.ending === "tail" ? 0 : +x[x.length - 1].slice(2) };
}
function buildWriter(w) {
  const tags = { o: "ABCD", e: "abcd" };
  const ops = [];
  w.sizes.forEach((sz, i) => {
    for (const f of w.fds) ops.push(`${f}${tags[f][i]}:${sz}`);
    if (w.pacing === "paced" && i < w.sizes.length - 1) ops.push(`s:${GAP}`);
  });
  switch (w.ending) {
    case "linger":
      ops.push(`s:${GAP * 3}`, `x:${w.code}`);
      break;
    case "exit":
      ops.push(`x:${w.code}`);
      break;
    case "tail":
      ops.push("f", `s:${GAP * 2}`);
      for (const f of w.fds) ops.push(`${f}${f === "o" ? "T" : "t"}:3`);
      ops.push(`s:${GAP}`, "x:0");
      break;
    case "hangup":
      for (const f of w.fds) ops.push(`c${f}`);
      ops.push(`s:${GAP * 3}`, `x:${w.code}`);
      break;
  }
  return ops;
}
function rebuild(sc, w) {
  const n = JSON.parse(JSON.stringify(sc));
  n.writer = buildWriter(w);
  n.meta.pacing = w.pacing;
  n.meta.ending = w.ending;
  n.spawnNap = w.pacing === "burst" ? NAP : 0;
  n.w = w;
  return n;
}
const clone = x => JSON.parse(JSON.stringify(x));
const hasNap = sc => Object.values(sc.pipes).some(p => p.actions.some(a => a.startsWith("nap")));

// candidate simplifications, most drastic first
function* candidates(sc) {
  const w = sc.w;
  const names = Object.keys(sc.pipes);
  if (names.length === 2)
    for (const drop of ["err", "out"]) {
      const n = clone(sc);
      delete n.pipes[drop];
      const w2 = clone(w);
      w2.fds = w2.fds.filter(f => f !== drop[0]);
      n.stdio = drop === "err" ? ["ignore", "pipe", "ignore"] : ["ignore", "ignore", "pipe"];
      yield [`drop ${drop}`, rebuild(n, w2)];
    }
  if (!sc.ue) {
    const n = clone(sc);
    n.ue = true;
    yield ["ue=true", n];
  }
  if (sc.markers) {
    const n = clone(sc);
    n.markers = false;
    yield ["markers=false", n];
  }
  if (w.ending !== "linger") yield ["ending=linger", rebuild(sc, { ...w, ending: "linger" })];
  if (w.ending !== "linger" && w.ending !== "exit") yield ["ending=exit", rebuild(sc, { ...w, ending: "exit" })];
  if (w.pacing === "burst" && w.sizes.length === 1) yield ["pacing=paced", rebuild(sc, { ...w, pacing: "paced" })];
  if (w.sizes.length > 1) {
    yield ["drop last chunk", rebuild(sc, { ...w, sizes: w.sizes.slice(0, -1) })];
    yield ["drop first chunk", rebuild(sc, { ...w, sizes: w.sizes.slice(1) })];
  }
  for (let i = 0; i < w.sizes.length; i++) if (w.sizes[i] !== 3) yield [`size${i}=3`, rebuild(sc, { ...w, sizes: w.sizes.map((s, j) => (j === i ? 3 : s)) })];
  if (w.code !== 0) yield ["code=0", rebuild(sc, { ...w, code: 0 })];
  for (const p of names) {
    const cfg = sc.pipes[p];
    if (cfg.mode !== "data") {
      const n = clone(sc);
      n.pipes[p].mode = "data";
      yield [`${p}.mode=data`, n];
    }
    if (cfg.at !== "sync") {
      const n = clone(sc);
      n.pipes[p].at = "sync";
      yield [`${p}.at=sync`, n];
    }
    for (let i = cfg.actions.length - 1; i >= 0; i--) {
      const a = cfg.actions[i];
      if (a !== "none") {
        const n = clone(sc);
        n.pipes[p].actions[i] = "none";
        yield [`${p}.a${i}=none`, n];
      }
      if (a.startsWith("async:")) {
        const n = clone(sc);
        n.pipes[p].actions[i] = a.split(":").slice(2).join(":");
        yield [`${p}.a${i} sync`, n];
      }
    }
  }
  if (sc.stdio.length !== 3 || sc.stdio[0] !== "ignore") {
    const n = clone(sc);
    n.stdio = ["ignore", sc.pipes.out ? "pipe" : "ignore", sc.pipes.err ? "pipe" : "ignore"];
    yield ["stdio simple", n];
  }
}

async function differs(sc) {
  const a = await runK(RT.node, sc, K);
  const b = await runK(RT[Bn], sc, K);
  const sa = new Set(a.map(t => norm(t, sc, level)));
  return { d: !b.some(t => sa.has(norm(t, sc, level))), a, b };
}

function signature(sc) {
  const parts = [];
  for (const [p, cfg] of Object.entries(sc.pipes)) {
    const acts = cfg.actions.map((a, i) => (a === "none" ? null : `${i + 1}:${a}`)).filter(Boolean);
    parts.push(`${p}{${cfg.mode}@${cfg.at}${cfg.mode === "paused" || cfg.mode.includes("readable") ? "/" + cfg.second : ""} [${acts.join(" ")}]}`);
  }
  parts.push(`writer{${sc.w.pacing} ${sc.w.sizes.join(",")} ${sc.w.ending}}`);
  parts.push(sc.ue ? "handler" : "NO-handler");
  if (sc.markers) parts.push("markers");
  return parts.join(" ");
}

const outFd = fs.openSync(outFile, "w");
let next = 0;
async function worker() {
  while (next < seeds.length) {
    const seed = seeds[next++];
    let sc = gen(seed);
    sc = rebuild(sc, parseWriter(sc));
    let evals = 0;
    let cur = await differs(sc);
    evals++;
    if (!cur.d) {
      fs.writeSync(outFd, JSON.stringify({ seed, reduced: false, note: "did not differ on re-run" }) + "\n");
      continue;
    }
    let progress = true;
    while (progress && evals < 70) {
      progress = false;
      for (const [name, cand] of candidates(sc)) {
        if (evals >= 70) break;
        const r = await differs(cand);
        evals++;
        if (r.d) {
          sc = cand;
          cur = r;
          progress = true;
          break;
        }
      }
    }
    // truncate actions that can never run
    const rec = { seed, reduced: true, evals, sig: signature(sc), sc, node: cur.a[0], other: cur.b[0] };
    fs.writeSync(outFd, JSON.stringify(rec) + "\n");
    process.stderr.write(`seed ${seed}: ${rec.sig} (${evals} evals)\n`);
  }
}
Promise.all(Array.from({ length: PAR }, worker)).then(() => fs.closeSync(outFd));
