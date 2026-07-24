#!/usr/bin/env bun
import { readFileSync } from "fs";

type Row = {
  rep: number;
  tags: Record<string, string | number>;
  result: {
    label: string; wall_ms: number; user_ms: number; sys_ms: number;
    peak_rss_kb: number; exit?: number;
    load?: { reqs: number; errs: number; rps: number; mb: number };
    gc: { heaps: number; primary: null | {
      full_gc: number; eden_gc: number; full_gc_ms: number; eden_gc_ms: number;
      peak_heap_kb: number; live_kb_max: number; live_kb_med: number; live_kb_last: number;
    }; total: { full_gc: number; eden_gc: number; full_gc_ms: number; eden_gc_ms: number } };
  };
};

const rows: Row[] = readFileSync(process.argv[2] ?? "results.ndjson", "utf8")
  .split("\n").filter(Boolean).map(l => JSON.parse(l));

function med(a: number[]) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function mean(a: number[]) { return a.reduce((s, x) => s + x, 0) / a.length; }

function key(r: Row): string {
  const t = r.tags;
  return `${t.phase}|${t.wl}|${t.knob ?? ""}|${t.val ?? ""}|${t.regime ?? t.ram ?? ""}`;
}

const groups = new Map<string, Row[]>();
for (const r of rows) {
  const k = key(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push(r);
}

type Agg = {
  phase: string; wl: string; knob: string; val: number | string; regime: string;
  n: number; wall_s: number; user_s: number; cpu_s: number;
  rss_mb: number; heap_mb: number; live_mb: number;
  full_gc: number; full_gc_ms: number; eden_gc: number; eden_gc_ms: number;
  rps?: number; cpu_us_per_req?: number;
};

const aggs: Agg[] = [];
for (const [k, rs] of groups) {
  const t = rs[0].tags;
  const pick = (f: (r: Row) => number) => med(rs.map(f));
  const rss_mb = pick(r => r.result.peak_rss_kb) / 1024;
  const heap_mb = pick(r => r.result.gc.primary?.peak_heap_kb ?? 0) / 1024;
  const live_mb = pick(r => r.result.gc.primary?.live_kb_max ?? 0) / 1024;
  const wall_s = pick(r => r.result.wall_ms) / 1000;
  const user_s = pick(r => r.result.user_ms) / 1000;
  const sys_s = pick(r => r.result.sys_ms) / 1000;
  const full_gc = pick(r => r.result.gc.primary?.full_gc ?? 0);
  const full_gc_ms = pick(r => r.result.gc.primary?.full_gc_ms ?? 0);
  const eden_gc = pick(r => r.result.gc.primary?.eden_gc ?? 0);
  const eden_gc_ms = pick(r => r.result.gc.primary?.eden_gc_ms ?? 0);
  const a: Agg = {
    phase: String(t.phase), wl: String(t.wl), knob: String(t.knob ?? ""),
    val: t.val ?? "", regime: String(t.regime ?? t.ram ?? ""),
    n: rs.length, wall_s, user_s, cpu_s: user_s + sys_s,
    rss_mb, heap_mb, live_mb, full_gc, full_gc_ms, eden_gc, eden_gc_ms,
  };
  if (rs[0].result.load) {
    a.rps = pick(r => r.result.load!.rps);
    const reqs = pick(r => r.result.load!.reqs);
    a.cpu_us_per_req = reqs > 0 ? Math.round((user_s + sys_s) * 1e6 / reqs) : 0;
  }
  aggs.push(a);
}

function table(title: string, rows: Agg[], cols: (keyof Agg)[]) {
  console.log("\n### " + title + "\n");
  const hdr = cols.map(c => String(c)).join("\t");
  console.log(hdr);
  for (const r of rows) {
    console.log(cols.map(c => {
      const v = r[c];
      if (typeof v === "number") return v < 10 && v % 1 !== 0 ? v.toFixed(2) : Math.round(v).toString();
      return String(v);
    }).join("\t"));
  }
}

// Baselines
console.log("=".repeat(70));
console.log("LIVE SETS (baseline, Bun defaults: MI=2.0, steepness=1.0)");
table("Baseline, >=16GB native", aggs.filter(a => a.phase === "baseline").sort((a,b)=>a.wl.localeCompare(b.wl)),
  ["wl", "live_mb", "heap_mb", "rss_mb", "wall_s", "cpu_s", "full_gc", "rps"]);

// >=16GB maxIncrease sweep
console.log("\n" + "=".repeat(70));
console.log(">=16GB: heapGrowthMaxIncrease sweep (steepness=1.0, ratio = val*e^(-x)+1 ~ val+1)");
for (const wl of ["tsc", "synth", "express", "fastify"]) {
  const rs = aggs.filter(a => a.phase === "ge16" && a.knob === "maxIncrease" && a.wl === wl)
    .sort((a, b) => Number(a.val) - Number(b.val));
  const cols: (keyof Agg)[] = rs[0]?.rps !== undefined
    ? ["val", "rss_mb", "heap_mb", "live_mb", "wall_s", "cpu_s", "full_gc", "full_gc_ms", "rps", "cpu_us_per_req"]
    : ["val", "rss_mb", "heap_mb", "live_mb", "wall_s", "cpu_s", "full_gc", "full_gc_ms"];
  table(wl, rs, cols);
}

// >=16GB steepness sweep
console.log("\n" + "=".repeat(70));
console.log(">=16GB: heapGrowthSteepnessFactor sweep (MI=2.0)");
for (const wl of ["tsc", "synth"]) {
  const rs = aggs.filter(a => a.phase === "ge16" && a.knob === "steepness" && a.wl === wl)
    .sort((a, b) => Number(a.val) - Number(b.val));
  table(wl, rs, ["val", "rss_mb", "heap_mb", "live_mb", "wall_s", "cpu_s", "full_gc", "full_gc_ms"]);
}

// <16GB small sweep
console.log("\n" + "=".repeat(70));
console.log("<16GB (forceRAMSize=8GB): smallHeapGrowthFactor sweep");
for (const wl of ["tsc", "synth", "express", "fastify"]) {
  const rs = aggs.filter(a => a.phase === "lt16" && a.knob === "small" && a.wl === wl)
    .sort((a, b) => Number(a.val) - Number(b.val));
  const cols: (keyof Agg)[] = rs[0]?.rps !== undefined
    ? ["val", "rss_mb", "heap_mb", "live_mb", "wall_s", "cpu_s", "full_gc", "full_gc_ms", "rps", "cpu_us_per_req"]
    : ["val", "rss_mb", "heap_mb", "live_mb", "wall_s", "cpu_s", "full_gc", "full_gc_ms"];
  table(wl, rs, cols);
}

// Spot checks
console.log("\n" + "=".repeat(70));
console.log("Spot-check: elysia / nodehttp / next");
for (const wl of ["elysia", "nodehttp", "next"]) {
  const rs = aggs.filter(a => a.phase === "spot" && a.wl === wl);
  const cols: (keyof Agg)[] = rs[0]?.rps !== undefined
    ? ["regime", "knob", "val", "rss_mb", "heap_mb", "live_mb", "cpu_s", "full_gc", "rps", "cpu_us_per_req"]
    : ["regime", "knob", "val", "rss_mb", "heap_mb", "live_mb", "wall_s", "cpu_s", "full_gc"];
  table(wl, rs, cols);
}
