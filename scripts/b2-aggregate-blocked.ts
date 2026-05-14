#!/usr/bin/env bun
// Aggregate blocked_on across all completed keystone wf outputs.
// Output: top blockers by frequency → next dispatch targets.
import { readdirSync, readFileSync, statSync } from "node:fs";

const TASKS = "/tmp/claude-0/-root-bun-5/8ee49164-8be4-4c77-9ff4-f6a0c7c979f6/tasks";
const blocked: Record<string, number> = {};
const symbols: Record<string, number> = {};
let done = 0,
  running = 0;

for (const f of readdirSync(TASKS)) {
  if (!f.endsWith(".output")) continue;
  const p = `${TASKS}/${f}`;
  if (statSync(p).size === 0) {
    running++;
    continue;
  }
  let r: any;
  try {
    r = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    continue;
  }
  const bl = r?.result?.impl?.blocked_on || r?.result?.blocked_on || r?.result?.blocked_on_all;
  if (!Array.isArray(bl)) continue;
  done++;
  for (const b of bl) {
    if (typeof b !== "string") continue;
    // Extract bun_X::Y pattern
    for (const m of b.matchAll(/\bbun_[a-z_]+::[A-Za-z_][A-Za-z0-9_:]*/g)) symbols[m[0]] = (symbols[m[0]] || 0) + 1;
    // Extract crate-level / module-level blockers
    const k = b.slice(0, 80).replace(/\s+/g, " ");
    blocked[k] = (blocked[k] || 0) + 1;
  }
}

const top = (o: Record<string, number>, n: number) =>
  Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);

console.error(`${done} wfs with blocked_on, ${running} still running`);
console.error("\nTop blocker phrases:");
for (const [k, n] of top(blocked, 15)) console.error(`  ${n}× ${k}`);
console.error("\nTop blocked-on symbols (for fill workflow):");
const syms = top(symbols, 50);
for (const [k, n] of syms.slice(0, 20)) console.error(`  ${n}× ${k}`);
console.log(JSON.stringify({ symbols: syms.map(([k]) => k) }));
