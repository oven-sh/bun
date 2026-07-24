#!/usr/bin/env bun
// Measure peak RSS of `jsc` running JetStream3 subtests under different JIT
// tier configurations, to isolate DFG/FTL compile-time working memory.
//
// Usage:
//   JSC=/path/to/jsc bun measure-jit-mem.ts [test1 test2 ...]
//
// Output: one JSON line per (test, config) with peak/final RSS and wall time.

import { spawn } from "bun";
import { readFileSync } from "fs";
import { join, dirname } from "path";

const JSC = process.env.JSC ?? "jsc";
const JS3 =
  process.env.JETSTREAM3_DIR ??
  join(dirname(import.meta.dirname), "..", "vendor/WebKit/PerformanceTests/JetStream3");

type Config = { name: string; env: Record<string, string> };

const CONFIGS: Config[] = [
  { name: "no-jit", env: { JSC_useJIT: "false" } },
  { name: "baseline-only", env: { JSC_useDFGJIT: "false", JSC_useFTLJIT: "false" } },
  { name: "dfg-only", env: { JSC_useFTLJIT: "false", JSC_useConcurrentJIT: "false" } },
  { name: "ftl", env: { JSC_useConcurrentJIT: "false" } },
  { name: "dfg-only-concurrent", env: { JSC_useFTLJIT: "false" } },
  { name: "ftl-concurrent", env: {} },
];

function readRssKb(pid: number): number {
  try {
    const s = readFileSync(`/proc/${pid}/statm`, "utf8");
    return (parseInt(s.split(" ")[1], 10) * 4096) / 1024;
  } catch {
    return -1;
  }
}

async function runOne(test: string, cfg: Config, iterations: number) {
  const proc = spawn({
    cmd: [JSC, "-e", `testList=[${JSON.stringify(test)}]; testIterationCount=${iterations};`, "cli.js"],
    cwd: JS3,
    env: { ...process.env, ...cfg.env },
    stdout: "ignore",
    stderr: "ignore",
  });
  const pid = proc.pid!;
  let peak = 0;
  let last = 0;
  const t0 = performance.now();
  const sampler = (async () => {
    while (true) {
      const r = readRssKb(pid);
      if (r < 0) break;
      last = r;
      if (r > peak) peak = r;
      await Bun.sleep(1);
    }
  })();
  const exit = await proc.exited;
  await sampler;
  return { peakKb: peak, finalKb: last, wallMs: performance.now() - t0, exit };
}

const DEFAULT_TESTS = [
  "richards",
  "delta-blue",
  "raytrace",
  "crypto",
  "navier-stokes",
  "gbemu",
  "Box2D",
  "typescript",
  "octane-zlib",
  "Babylon",
  "ML",
  "Air",
  "cdjs",
  "OfflineAssembler",
  "UniPoker",
  "float-mm.c",
  "hash-map",
  "ai-astar",
  "gaussian-blur",
];

const tests = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_TESTS;
const ITER = 120;

for (const test of tests) {
  for (const cfg of CONFIGS) {
    const r = await runOne(test, cfg, ITER);
    console.log(
      JSON.stringify({
        test,
        config: cfg.name,
        peakKb: Math.round(r.peakKb),
        finalKb: Math.round(r.finalKb),
        wallMs: Math.round(r.wallMs),
        exit: r.exit,
      })
    );
  }
}
