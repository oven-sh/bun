#!/usr/bin/env bun
// Trace RSS across DFG/B3/Air phases for the single heaviest compilation in a
// JetStream3 subtest. Correlates `JSC_logPhaseTimes=1` output with
// /proc/<pid>/statm samples to give a per-phase RSS high-water mark.
//
// Usage:
//   JSC=/path/to/jsc bun phase-mem.ts <test> [iterations] [dfg-only|ftl]

import { spawn } from "bun";
import { readFileSync } from "fs";
import { join, dirname } from "path";

const JSC = process.env.JSC ?? "jsc";
const JS3 =
  process.env.JETSTREAM3_DIR ??
  join(dirname(import.meta.dirname), "..", "vendor/WebKit/PerformanceTests/JetStream3");

function readRssKb(pid: number): number {
  try {
    const s = readFileSync(`/proc/${pid}/statm`, "utf8");
    return (parseInt(s.split(" ")[1], 10) * 4096) / 1024;
  } catch {
    return -1;
  }
}

const [test, itersArg, modeArg] = process.argv.slice(2);
if (!test) {
  console.error("usage: phase-mem.ts <test> [iterations] [dfg-only|ftl]");
  process.exit(1);
}
const iters = itersArg ? parseInt(itersArg, 10) : 20;
const useFtl = modeArg !== "dfg-only";

const proc = spawn({
  cmd: [JSC, "-e", `testList=[${JSON.stringify(test)}]; testIterationCount=${iters};`, "cli.js"],
  cwd: JS3,
  env: {
    ...process.env,
    JSC_useConcurrentJIT: "false",
    JSC_useFTLJIT: useFtl ? "true" : "false",
    JSC_logPhaseTimes: "true",
    JSC_reportCompileTimes: "true",
  },
  stdout: "ignore",
  stderr: "pipe",
});

const pid = proc.pid!;
const rss: Array<[number, number]> = [];
const t0 = performance.now();
let done = false;
(async () => {
  while (!done) {
    const r = readRssKb(pid);
    if (r < 0) break;
    rss.push([Math.round((performance.now() - t0) * 1000), r]);
    await Bun.sleep(0);
  }
})();

type Phase = { subsys: string; name: string; ms: number; endUs: number };
type Compile = { name: string; mode: string; codeSize: number; ms: number; endUs: number };
const phases: Phase[] = [];
const compiles: Compile[] = [];
const phaseRe = /^\[(\w+)\] (.+) took: ([0-9.]+) ms/;
const compRe = /^Optimized (.*) using (\S+) with (\S+) into (\d+) bytes in ([0-9.]+) ms/;
let buf = "";
for await (const chunk of proc.stderr) {
  buf += new TextDecoder().decode(chunk);
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    const now = Math.round((performance.now() - t0) * 1000);
    let m;
    if ((m = phaseRe.exec(line)))
      phases.push({ subsys: m[1], name: m[2], ms: parseFloat(m[3]), endUs: now });
    else if ((m = compRe.exec(line)))
      compiles.push({ name: m[1], mode: m[2], codeSize: parseInt(m[4], 10), ms: parseFloat(m[5]), endUs: now });
  }
}
await proc.exited;
done = true;

const findIdx = (us: number) => {
  let lo = 0,
    hi = rss.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rss[mid][0] < us) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, rss.length - 1);
};

let best: { c: Compile; spike: number; before: number; peak: number } | null = null;
for (const c of compiles) {
  if (c.mode === "Baseline") continue;
  const startUs = c.endUs - c.ms * 1000;
  const i0 = Math.max(0, findIdx(startUs) - 1);
  const i1 = findIdx(c.endUs);
  let peak = 0;
  for (let i = i0; i <= i1; i++) peak = Math.max(peak, rss[i][1]);
  const before = rss[Math.max(0, i0 - 2)]?.[1] ?? rss[0][1];
  const spike = peak - before;
  if (!best || spike > best.spike) best = { c, spike, before, peak };
}

if (!best) {
  console.log("no DFG/FTL compiles found");
  process.exit(0);
}

const { c } = best;
const startUs = c.endUs - c.ms * 1000;
console.log(
  `Biggest compile: ${c.name.slice(0, 60)} mode=${c.mode} codeSize=${(c.codeSize / 1024).toFixed(1)}KB ms=${c.ms.toFixed(1)}`
);
console.log(`  RSS before=${best.before}KB peak=${best.peak}KB spike=${best.spike}KB\n`);
console.log("phase".padEnd(46), "ms".padStart(8), "rssKb".padStart(10), "deltaKb".padStart(10), "phaseDeltaKb".padStart(12));
let prev = best.before;
for (const ph of phases) {
  if (ph.endUs < startUs - 1000 || ph.endUs > c.endUs + 1000) continue;
  const r = rss[findIdx(ph.endUs)]?.[1] ?? 0;
  console.log(
    `[${ph.subsys}] ${ph.name}`.slice(0, 46).padEnd(46),
    ph.ms.toFixed(2).padStart(8),
    String(r).padStart(10),
    String(r - best.before).padStart(10),
    String(r - prev).padStart(12)
  );
  prev = r;
}
