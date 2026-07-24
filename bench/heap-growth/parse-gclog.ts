#!/usr/bin/env bun
// Parse BUN_JSC_logGC=1 output from stdin. Handles multi-line collections
// and multiple heaps (workers/child processes). Prints one JSON object.

const text = await Bun.stdin.text();

type Coll = { scope: "Full" | "Eden"; startKb: number; endKb: number; cycleMs: number };
type HeapStats = { full: Coll[]; eden: Coll[]; peakStartKb: number };

const heaps = new Map<string, HeapStats>();
let pending = new Map<string, { scope: "Full" | "Eden"; startKb: number }>();

for (const line of text.split("\n")) {
  // START line: [GC<0x...>: START M 4637kb => FullCollection, ...
  let m = line.match(/\[GC<(0x[0-9a-f]+)>: START [MC] (\d+)kb /);
  if (m) {
    const hp = m[1];
    const startKb = parseInt(m[2], 10);
    const scopeM = line.match(/=> (Full|Eden)Collection/);
    const scope = (scopeM ? scopeM[1] : "Eden") as "Full" | "Eden";
    pending.set(hp, { scope, startKb });
    let hs = heaps.get(hp);
    if (!hs) { hs = { full: [], eden: [], peakStartKb: 0 }; heaps.set(hp, hs); }
    if (startKb > hs.peakStartKb) hs.peakStartKb = startKb;
  }
  // END segment: => 65712kb, p=... cycle 1.10ms END]
  // May appear on same line as START (single-pass) or on a later continuation
  // line that starts with [GC<0x...>: C ... or just contains it.
  // We scan every line for every pending heap's END marker by heap ptr.
  const endAll = [...line.matchAll(/=> (\d+)kb, p=[0-9.]+ms \(max [0-9.]+\), cycle ([0-9.]+)ms END\]/g)];
  if (endAll.length) {
    // Which heap? The continuation line format is [GC<0x...>: ... => Nkb, ... END]
    // or the END appears on the same line as a START. Find heap ptr on this line.
    const hpM = line.match(/\[GC<(0x[0-9a-f]+)>/);
    const hp = hpM ? hpM[1] : null;
    for (const em of endAll) {
      const endKb = parseInt(em[1], 10);
      const cycleMs = parseFloat(em[2]);
      let p = hp ? pending.get(hp) : undefined;
      if (!p && pending.size === 1) p = [...pending.values()][0];
      const key = hp ?? [...pending.keys()][0];
      if (p && key) {
        const hs = heaps.get(key)!;
        const c: Coll = { scope: p.scope, startKb: p.startKb, endKb, cycleMs };
        (p.scope === "Full" ? hs.full : hs.eden).push(c);
        pending.delete(key);
      }
    }
  }
}

// Aggregate: treat the heap with the largest peak as primary; also sum all.
let primary: [string, HeapStats] | null = null;
for (const e of heaps) {
  if (!primary || e[1].peakStartKb > primary[1].peakStartKb) primary = e;
}

function agg(hs: HeapStats) {
  const fullMs = hs.full.reduce((s, c) => s + c.cycleMs, 0);
  const edenMs = hs.eden.reduce((s, c) => s + c.cycleMs, 0);
  const liveKb = hs.full.map(c => c.endKb);
  liveKb.sort((a, b) => a - b);
  return {
    full_gc: hs.full.length,
    eden_gc: hs.eden.length,
    full_gc_ms: Math.round(fullMs),
    eden_gc_ms: Math.round(edenMs),
    peak_heap_kb: hs.peakStartKb,
    live_kb_max: liveKb.length ? liveKb[liveKb.length - 1] : 0,
    live_kb_med: liveKb.length ? liveKb[Math.floor(liveKb.length / 2)] : 0,
    live_kb_last: hs.full.length ? hs.full[hs.full.length - 1].endKb : 0,
  };
}

const allFull = [...heaps.values()].reduce((s, h) => s + h.full.length, 0);
const allEden = [...heaps.values()].reduce((s, h) => s + h.eden.length, 0);
const allFullMs = Math.round([...heaps.values()].reduce((s, h) => s + h.full.reduce((a, c) => a + c.cycleMs, 0), 0));
const allEdenMs = Math.round([...heaps.values()].reduce((s, h) => s + h.eden.reduce((a, c) => a + c.cycleMs, 0), 0));

const out = {
  heaps: heaps.size,
  primary: primary ? agg(primary[1]) : null,
  total: { full_gc: allFull, eden_gc: allEden, full_gc_ms: allFullMs, eden_gc_ms: allEdenMs },
};
console.log(JSON.stringify(out));
