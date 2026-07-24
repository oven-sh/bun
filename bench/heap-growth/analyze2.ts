#!/usr/bin/env bun
import { readFileSync } from "fs";
const rows = readFileSync(process.argv[2] ?? "results2.ndjson", "utf8")
  .split("\n").filter(Boolean).map(l => JSON.parse(l));

function med(a: number[]) { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }

const groups = new Map<string, any[]>();
for (const r of rows) {
  const t = r.tags;
  const k = `${t.phase}|${t.wl}|${t.ratio}|${t.mi ?? ""}|${t.small ?? ""}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push(r);
}

type Agg = {
  phase: string; wl: string; ratio: number; mi?: number; small?: number;
  rss_mb: number; heap_mb: number; live_mb: number; wall_s: number; cpu_s: number;
  full_gc: number; full_ms: number; rps?: number; cpu_us_req?: number;
};
const aggs: Agg[] = [];
for (const [, rs] of groups) {
  const t = rs[0].tags;
  const p = (f: (r: any) => number) => med(rs.map(f));
  const a: Agg = {
    phase: t.phase, wl: t.wl, ratio: t.ratio, mi: t.mi, small: t.small,
    rss_mb: Math.round(p(r => r.result.peak_rss_kb) / 1024),
    heap_mb: Math.round(p(r => r.result.gc?.primary?.peak_heap_kb ?? 0) / 1024),
    live_mb: Math.round(p(r => r.result.gc?.primary?.live_kb_max ?? 0) / 1024),
    wall_s: +(p(r => r.result.wall_ms) / 1000).toFixed(2),
    cpu_s: +(p(r => (r.result.user_ms + r.result.sys_ms)) / 1000).toFixed(1),
    full_gc: p(r => r.result.gc?.primary?.full_gc ?? 0),
    full_ms: p(r => r.result.gc?.primary?.full_gc_ms ?? 0),
  };
  if (rs[0].result.load) {
    const reqs = p(r => r.result.load.reqs);
    a.rps = p(r => r.result.load.rps);
    a.cpu_us_req = reqs ? Math.round(a.cpu_s * 1e6 / reqs) : 0;
  }
  aggs.push(a);
}

function table(title: string, rs: Agg[], cols: string[]) {
  console.log(`\n### ${title}\n`);
  console.log(cols.join("\t"));
  for (const r of rs) console.log(cols.map(c => (r as any)[c]).join("\t"));
}

console.log("========================================================");
console.log("Phase A: >=16GB, minEdenToOldGenerationRatio × heapGrowthMaxIncrease");
for (const wl of ["tsc", "synth", "express", "fastify"]) {
  const rs = aggs.filter(a => a.phase === "A" && a.wl === wl)
    .sort((a, b) => (a.ratio! - b.ratio!) || (a.mi! - b.mi!));
  const cols = rs[0]?.rps !== undefined
    ? ["ratio", "mi", "rss_mb", "heap_mb", "full_gc", "full_ms", "cpu_s", "rps", "cpu_us_req"]
    : ["ratio", "mi", "rss_mb", "heap_mb", "live_mb", "wall_s", "cpu_s", "full_gc", "full_ms"];
  table(wl, rs, cols);
}

console.log("\n========================================================");
console.log("Phase B: <16GB (8GB), minEdenToOldGenerationRatio × smallHeapGrowthFactor");
for (const wl of ["tsc", "synth", "express", "fastify"]) {
  const rs = aggs.filter(a => a.phase === "B" && a.wl === wl)
    .sort((a, b) => (a.ratio! - b.ratio!) || (a.small! - b.small!));
  const cols = rs[0]?.rps !== undefined
    ? ["ratio", "small", "rss_mb", "heap_mb", "full_gc", "full_ms", "cpu_s", "rps", "cpu_us_req"]
    : ["ratio", "small", "rss_mb", "heap_mb", "live_mb", "wall_s", "cpu_s", "full_gc", "full_ms"];
  table(wl, rs, cols);
}
