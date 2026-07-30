#!/usr/bin/env node
// Differential fuzzer driver: runs generated Temporal cases under
//   1. JSC jsc shell (target)
//   2. node with @js-temporal/polyfill (reference)
// and reports crashes and divergences.
"use strict";
const { spawnSync } = require("child_process");
const { writeFileSync, mkdirSync, existsSync } = require("fs");
const { generate, emitRunner } = require("./gen.js");

const JSC = process.env.JSC || "/workspace/upstream-webkit/WebKitBuild/JSCOnly/Debug/bin/jsc";
const NODE = process.env.NODE || process.execPath;
const BATCH = parseInt(process.env.BATCH || "500", 10);
const SEEDS = parseInt(process.env.SEEDS || "40", 10);
const START_SEED = parseInt(process.env.START_SEED || "1", 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "30000", 10);
const OUT = process.env.OUT || "/tmp/temporal-fuzz/out";

mkdirSync(OUT, { recursive: true });

// Node reference uses the polyfill explicitly so we compare spec-reference
// semantics regardless of what node ships.
const nodePrelude = `
"use strict";
const { Temporal } = require("@js-temporal/polyfill");
globalThis.Temporal = Temporal;
const print = (s) => process.stdout.write(s + "\\n");
`;

function runJSC(file) {
  return spawnSync(JSC, ["--useDollarVM=1", file], {
    env: { ...process.env, ASAN_OPTIONS: "abort_on_error=1:detect_leaks=0", Malloc: "1" },
    timeout: TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function runNode(file) {
  return spawnSync(NODE, [file], {
    cwd: __dirname,
    timeout: TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function parseLines(out) {
  const m = new Map();
  for (const line of out.split("\n")) {
    const i = line.indexOf("|");
    if (i < 0) continue;
    m.set(parseInt(line.slice(0, i), 10), line.slice(i + 1));
  }
  return m;
}

const summary = { seeds: 0, cases: 0, jsc_crashes: [], node_crashes: [], divergences: [], timeouts: [] };

for (let seed = START_SEED; seed < START_SEED + SEEDS; seed++) {
  const cases = generate(seed, BATCH);
  const runner = emitRunner(cases);
  const jscFile = `${OUT}/seed-${seed}-jsc.js`;
  const nodeFile = `${OUT}/seed-${seed}-node.js`;
  writeFileSync(jscFile, runner);
  writeFileSync(nodeFile, nodePrelude + runner);

  const jsc = runJSC(jscFile);
  const ref = runNode(nodeFile);
  summary.seeds++;
  summary.cases += cases.length;

  // Crash/timeout detection for JSC (the target)
  if (jsc.error && jsc.error.code === "ETIMEDOUT") {
    summary.timeouts.push({ seed, side: "jsc" });
    // Bisect to find the hanging case
    bisectHang(cases, seed, "jsc", runJSC, (body) => body);
    continue;
  }
  if (jsc.signal || (jsc.status !== 0 && jsc.status !== null)) {
    // JSC crashed on the batch. Bisect.
    const crashInfo = { seed, signal: jsc.signal, status: jsc.status, stderr: (jsc.stderr||"").slice(-2000) };
    const culprit = bisectCrash(cases, seed, runJSC, (body) => body);
    crashInfo.culprit = culprit;
    summary.jsc_crashes.push(crashInfo);
    writeFileSync(`${OUT}/CRASH-jsc-seed${seed}.json`, JSON.stringify(crashInfo, null, 2));
    process.stderr.write(`CRASH jsc seed=${seed} signal=${jsc.signal} status=${jsc.status}\n`);
    continue;
  }

  if (ref.error && ref.error.code === "ETIMEDOUT") {
    summary.timeouts.push({ seed, side: "node" });
    continue;
  }
  if (ref.signal || (ref.status !== 0 && ref.status !== null)) {
    summary.node_crashes.push({ seed, signal: ref.signal, status: ref.status });
    continue;
  }

  // Diff
  const jm = parseLines(jsc.stdout || "");
  const rm = parseLines(ref.stdout || "");
  for (let i = 0; i < cases.length; i++) {
    const a = jm.get(i), b = rm.get(i);
    if (a === b) continue;
    // Normalize: both throwing same error type = OK? Spec mandates error types, so a diff in THROW type is interesting.
    summary.divergences.push({
      seed, idx: i,
      expr: cases[i].expr,
      tags: cases[i].tags,
      jsc: a,
      polyfill: b,
    });
  }
  process.stderr.write(`seed=${seed} cases=${cases.length} crashes=0 divs=${summary.divergences.length}\r`);
}

function bisectCrash(cases, seed, run, wrap) {
  let lo = 0, hi = cases.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const sub = cases.slice(lo, mid);
    const body = emitRunner(sub);
    const f = `${OUT}/bisect-${seed}.js`;
    writeFileSync(f, wrap(body));
    const r = run(f);
    if (r.signal || (r.status !== 0 && r.status !== null)) hi = mid;
    else lo = mid;
  }
  // lo..hi now brackets 1 case; verify isolation
  const one = cases.slice(lo, hi);
  const f = `${OUT}/bisect-${seed}-iso.js`;
  writeFileSync(f, wrap(emitRunner(one)));
  const r = run(f);
  return {
    idx: lo,
    expr: one[0].expr,
    tags: one[0].tags,
    isolated_signal: r.signal,
    isolated_status: r.status,
    isolated_stderr: (r.stderr || "").slice(-2000),
  };
}

function bisectHang(cases, seed, side, run, wrap) {
  // Similar, but looking for ETIMEDOUT
  let lo = 0, hi = cases.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const sub = cases.slice(lo, mid);
    const f = `${OUT}/bisect-hang-${seed}.js`;
    writeFileSync(f, wrap(emitRunner(sub)));
    const r = run(f);
    if (r.error && r.error.code === "ETIMEDOUT") hi = mid; else lo = mid;
  }
  const one = cases.slice(lo, hi);
  summary.timeouts[summary.timeouts.length-1].culprit = { idx: lo, expr: one[0].expr, tags: one[0].tags };
}

process.stderr.write("\n");
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  seeds: summary.seeds,
  cases: summary.cases,
  jsc_crashes: summary.jsc_crashes.length,
  node_crashes: summary.node_crashes.length,
  timeouts: summary.timeouts.length,
  divergences: summary.divergences.length,
}, null, 2));
