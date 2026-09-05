/**
 * Post-build phase timing summary from ninja's own `.ninja_log`, so CI logs say where the wall
 * time went without scraping timestamps: how long the C/C++ objects, cargo, and the link took,
 * and how much of that overlapped.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { BunOutput } from "./bun.ts";
import type { Config } from "./config.ts";

interface Edge {
  startMs: number;
  endMs: number;
  output: string;
}

/** Number of lines currently in `.ninja_log`; pass to printBuildTimings to only count newer edges. */
export function ninjaLogMark(buildDir: string): number {
  const path = join(buildDir, ".ninja_log");
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").length : 0;
}

/**
 * `.ninja_log` (v5–v7): one line per output of each finished edge —
 * start ms, end ms (both relative to that ninja process's start), mtime, then output path and
 * command hash (v7: path before hash; v5/v6: hash last as well, path 4th). Edges with several
 * outputs repeat with identical times; they are merged.
 */
function readEdges(buildDir: string, sinceLine: number): Edge[] {
  const path = join(buildDir, ".ninja_log");
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").slice(sinceLine);
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const line of lines) {
    if (line === "" || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 5) continue;
    const startMs = Number(f[0]);
    const endMs = Number(f[1]);
    const key = `${f[0]}\t${f[1]}\t${f[4]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ startMs, endMs, output: f[3]! });
  }
  return edges;
}

type Phase =
  | "deps + fetch"
  | "codegen"
  | "c/c++ objects"
  | "cargo"
  | "archive"
  | "link"
  | "strip + post-link"
  | "other";

function classify(cfg: Config, output: BunOutput, edge: Edge): Phase {
  const rel = (p: string | undefined) =>
    p === undefined ? undefined : relative(cfg.buildDir, resolve(cfg.buildDir, p));
  const o = edge.output;
  if (o === rel(output.exe) || o.endsWith(".linker-map")) return "link";
  if (o === rel(output.strippedExe) || o === rel(output.dsym) || (output.uploadStamps ?? []).map(rel).includes(o))
    return "strip + post-link";
  if (o === rel(output.archive) || /^lib[^/]*\.(a|lib)$/.test(o)) return "archive";
  if (o.startsWith("rust-target/") || output.rustObjects.map(rel).includes(o)) return "cargo";
  if (o.startsWith("obj/") || o.startsWith("pch/")) return "c/c++ objects";
  if (o.startsWith("codegen/")) return "codegen";
  if (o.startsWith("cache/") || o.startsWith("deps/") || o.startsWith("stamps/") || o.startsWith("../"))
    return "deps + fetch";
  return "other";
}

function fmt(ms: number): string {
  const s = ms / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s` : `${s.toFixed(1)}s`;
}

/** Print one line per phase: when it ran within the ninja invocation, its wall span, and summed CPU-time of its edges. */
export function printBuildTimings(cfg: Config, output: BunOutput, sinceLine: number): void {
  const edges = readEdges(cfg.buildDir, sinceLine);
  if (edges.length === 0) return;
  const phases = new Map<Phase, { start: number; end: number; sum: number; n: number }>();
  for (const e of edges) {
    const k = classify(cfg, output, e);
    const p = phases.get(k) ?? { start: Infinity, end: -Infinity, sum: 0, n: 0 };
    p.start = Math.min(p.start, e.startMs);
    p.end = Math.max(p.end, e.endMs);
    p.sum += e.endMs - e.startMs;
    p.n++;
    phases.set(k, p);
  }
  const total = Math.max(...edges.map(e => e.endMs)) - Math.min(...edges.map(e => e.startMs));
  const order: Phase[] = [
    "deps + fetch",
    "codegen",
    "c/c++ objects",
    "cargo",
    "archive",
    "link",
    "strip + post-link",
    "other",
  ];
  console.log(
    `[timing] ${"phase".padEnd(18)} ${"from".padStart(8)} ${"to".padStart(8)} ${"wall".padStart(8)} ${"cpu-sum".padStart(9)}  edges`,
  );
  for (const k of order) {
    const p = phases.get(k);
    if (p === undefined) continue;
    console.log(
      `[timing] ${k.padEnd(18)} ${fmt(p.start).padStart(8)} ${fmt(p.end).padStart(8)} ${fmt(p.end - p.start).padStart(8)} ${fmt(p.sum).padStart(9)}  ${p.n}`,
    );
  }
  console.log(`[timing] ${"total (ninja)".padEnd(18)} ${"".padStart(8)} ${"".padStart(8)} ${fmt(total).padStart(8)}`);
  console.log(`[timing] toolchain: cc=${cfg.cc} rustc=${cfg.rustc ?? "-"} cargo=${cfg.cargo ?? "-"}`);
}
