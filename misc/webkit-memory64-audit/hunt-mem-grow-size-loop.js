// CATEGORY: memory.grow/size in tight loop with tier-up (memory64)
// Run memory.grow / memory.size heavily so BBQ/OMG tier up; verify the i64
// result stays correct across tiers. memory.grow(huge) must return i64 -1
// (all 64 bits set), not a zero-extended 32-bit -1. memory.grow(2^32) must
// NOT be truncated to grow(0).

import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

const WABT_OPTS = { memory64: true, threads: true, reference_types: true, bulk_memory: true, gc: true, exceptions: true };

function out(name, result) {
  // Deterministic "NAME<tab>RESULT"
  print(name + "\t" + result);
}

function fmt(v) {
  if (typeof v === "bigint") return v.toString() + "n";
  return String(v);
}

const ITER = 200000; // enough to force BBQ -> OMG tier-up

// Edge-case i64 values for memory.grow deltas.
const EDGE = [
  ["0", 0n],
  ["1", 1n],
  ["2^31-1", 2147483647n],
  ["2^31", 2147483648n],
  ["2^32-1", 4294967295n],
  ["2^32", 4294967296n],
  ["2^32+1", 4294967297n],
  ["2^63-1", 9223372036854775807n],
  ["2^63", -9223372036854775808n], // 0x8000_0000_0000_0000 as signed i64
  ["2^64-1", -1n],                 // 0xFFFF_FFFF_FFFF_FFFF as signed i64
];

async function make(wat) {
  return await instantiate(wat, {}, WABT_OPTS);
}

// ---------------------------------------------------------------------------
// Module A: direct wrappers so the JS->wasm call itself is the hot body.
// ---------------------------------------------------------------------------
async function testJSLoop() {
  const inst = await make(`
    (module
      (memory i64 3 8)
      (func (export "size") (result i64)
        memory.size)
      (func (export "grow") (param i64) (result i64)
        local.get 0
        memory.grow)
      (func (export "growC") (param i64) (result i64)
        ;; keep the value in a local then return it so tiers must
        ;; materialise the full 64-bit result, not just branch on it.
        (local $r i64)
        local.get 0
        memory.grow
        local.set $r
        local.get $r)
    )`);
  const { size, grow, growC } = inst.exports;

  // --- memory.size loop ---
  let bad = 0n, last = 0n;
  for (let i = 0; i < ITER; i++) {
    const s = size();
    if (s !== 3n) bad++;
    last = s;
  }
  out("jsloop.size.last", fmt(last));
  out("jsloop.size.badcount", bad.toString());

  // --- memory.grow(0) loop: must keep returning 3n ---
  bad = 0n; last = 0n;
  for (let i = 0; i < ITER; i++) {
    const r = grow(0n);
    if (r !== 3n) bad++;
    last = r;
  }
  out("jsloop.grow0.last", fmt(last));
  out("jsloop.grow0.badcount", bad.toString());

  // --- memory.grow(huge) loop: must keep returning -1n (all 64 bits) ---
  // Using 2^32-1 which can never succeed with max=8.
  bad = 0n; last = 0n; let wrongHi = 0n;
  for (let i = 0; i < ITER; i++) {
    const r = growC(4294967295n);
    if (r !== -1n) bad++;
    // catch zero-extended 32-bit -1 (4294967295n)
    if (r === 4294967295n) wrongHi++;
    last = r;
  }
  out("jsloop.growHuge.last", fmt(last));
  out("jsloop.growHuge.badcount", bad.toString());
  out("jsloop.growHuge.zeroExtCount", wrongHi.toString());

  // --- after all that, size must still be 3 ---
  out("jsloop.finalSize", fmt(size()));
}

// ---------------------------------------------------------------------------
// Module B: wasm-internal hot loop (OSR inside wasm).
// ---------------------------------------------------------------------------
async function testWasmLoop() {
  const inst = await make(`
    (module
      (memory i64 2 4)
      ;; loop N times, return the last memory.size observed + a mismatch count
      (func (export "sizeLoop") (param $n i64) (result i64 i64)
        (local $i i64) (local $last i64) (local $bad i64)
        (block $done
          (loop $l
            local.get $i local.get $n i64.ge_u br_if $done
            memory.size local.set $last
            local.get $last i64.const 2 i64.ne
            if local.get $bad i64.const 1 i64.add local.set $bad end
            local.get $i i64.const 1 i64.add local.set $i
            br $l))
        local.get $last local.get $bad)

      ;; loop N times calling memory.grow(0); return last result + mismatch count
      (func (export "grow0Loop") (param $n i64) (result i64 i64)
        (local $i i64) (local $last i64) (local $bad i64)
        (block $done
          (loop $l
            local.get $i local.get $n i64.ge_u br_if $done
            i64.const 0 memory.grow local.set $last
            local.get $last i64.const 2 i64.ne
            if local.get $bad i64.const 1 i64.add local.set $bad end
            local.get $i i64.const 1 i64.add local.set $i
            br $l))
        local.get $last local.get $bad)

      ;; loop N times calling memory.grow($delta) where delta is huge; every call
      ;; must return -1. Returns last result, count(!= -1), count(== u32 max).
      (func (export "growHugeLoop") (param $n i64) (param $delta i64) (result i64 i64 i64)
        (local $i i64) (local $last i64) (local $bad i64) (local $zx i64)
        (block $done
          (loop $l
            local.get $i local.get $n i64.ge_u br_if $done
            local.get $delta memory.grow local.set $last
            local.get $last i64.const -1 i64.ne
            if local.get $bad i64.const 1 i64.add local.set $bad end
            local.get $last i64.const 4294967295 i64.eq
            if local.get $zx i64.const 1 i64.add local.set $zx end
            local.get $i i64.const 1 i64.add local.set $i
            br $l))
        local.get $last local.get $bad local.get $zx)

      (func (export "size") (result i64) memory.size)
    )`);

  const { sizeLoop, grow0Loop, growHugeLoop, size } = inst.exports;
  const N = BigInt(ITER);

  {
    const [last, bad] = sizeLoop(N);
    out("wasmloop.size.last", fmt(last));
    out("wasmloop.size.badcount", fmt(bad));
  }
  {
    const [last, bad] = grow0Loop(N);
    out("wasmloop.grow0.last", fmt(last));
    out("wasmloop.grow0.badcount", fmt(bad));
  }
  {
    const [last, bad, zx] = growHugeLoop(N, 4294967295n); // 2^32-1
    out("wasmloop.growHuge(2^32-1).last", fmt(last));
    out("wasmloop.growHuge(2^32-1).badcount", fmt(bad));
    out("wasmloop.growHuge(2^32-1).zeroExtCount", fmt(zx));
  }
  {
    const [last, bad, zx] = growHugeLoop(N, 9223372036854775807n); // 2^63-1
    out("wasmloop.growHuge(2^63-1).last", fmt(last));
    out("wasmloop.growHuge(2^63-1).badcount", fmt(bad));
    out("wasmloop.growHuge(2^63-1).zeroExtCount", fmt(zx));
  }
  out("wasmloop.finalSize", fmt(size()));
}

// ---------------------------------------------------------------------------
// Module C: edge-case deltas, each under its own hot loop. A fresh instance
// per case so "accidental" growth from a truncated delta is observable.
// ---------------------------------------------------------------------------
async function testEdgeDeltas() {
  const wat = `
    (module
      (memory i64 1 4)
      (func (export "grow") (param i64) (result i64)
        local.get 0 memory.grow)
      (func (export "size") (result i64) memory.size)
      ;; hot wasm loop version
      (func (export "growLoop") (param $n i64) (param $d i64) (result i64 i64)
        (local $i i64) (local $last i64) (local $bad i64)
        (block $done
          (loop $l
            local.get $i local.get $n i64.ge_u br_if $done
            local.get $d memory.grow local.set $last
            local.get $last i64.const -1 i64.ne
            if local.get $bad i64.const 1 i64.add local.set $bad end
            local.get $i i64.const 1 i64.add local.set $i
            br $l))
        local.get $last local.get $bad)
    )`;

  for (const [name, d] of EDGE) {
    const inst = await make(wat);
    const { grow, size, growLoop } = inst.exports;

    if (d === 0n || d === 1n) {
      // These succeed at least once; run cold+hot but only check invariants.
      const first = grow(d);
      out(`edge.grow(${name}).first`, fmt(first));
      // warm
      let last = first;
      for (let i = 0; i < ITER; i++) last = grow(0n);
      out(`edge.grow(${name}).warm.grow0.last`, fmt(last));
      out(`edge.grow(${name}).finalSize`, fmt(size()));
      continue;
    }

    // Huge deltas: must always fail with -1. If delta got truncated to 32 bits,
    // 2^32 would act like 0 (success), 2^32+1 like 1 (grows!), 2^63 like 0, etc.
    // JS-side warm-up first:
    let badJS = 0, last = 0n;
    for (let i = 0; i < ITER; i++) {
      const r = grow(d);
      if (r !== -1n) badJS++;
      last = r;
    }
    out(`edge.grow(${name}).jsloop.last`, fmt(last));
    out(`edge.grow(${name}).jsloop.badcount`, String(badJS));
    // Wasm-side hot loop:
    const [wlast, wbad] = growLoop(BigInt(ITER), d);
    out(`edge.grow(${name}).wasmloop.last`, fmt(wlast));
    out(`edge.grow(${name}).wasmloop.badcount`, fmt(wbad));
    // Memory must not have grown at all.
    out(`edge.grow(${name}).finalSize`, fmt(size()));
  }
}

// ---------------------------------------------------------------------------
// Module D: grow then size, interleaved, across tier-up.
// ---------------------------------------------------------------------------
async function testInterleaved() {
  const inst = await make(`
    (module
      (memory i64 1 10)
      (func (export "step") (result i64 i64)
        ;; returns (grow(0), size)
        i64.const 0 memory.grow
        memory.size)
      (func (export "grow1") (result i64) i64.const 1 memory.grow)
      (func (export "size") (result i64) memory.size)
    )`);
  const { step, grow1, size } = inst.exports;

  // warm step() at size=1
  let bad = 0; let lg = 0n, ls = 0n;
  for (let i = 0; i < ITER; i++) {
    const [g, s] = step();
    if (g !== 1n || s !== 1n) bad++;
    lg = g; ls = s;
  }
  out("interleave.phase1.lastGrow", fmt(lg));
  out("interleave.phase1.lastSize", fmt(ls));
  out("interleave.phase1.badcount", String(bad));

  // now actually grow to 5 and re-run hot step(): tiered code must see new size.
  for (let k = 0; k < 4; k++) grow1();
  bad = 0;
  for (let i = 0; i < ITER; i++) {
    const [g, s] = step();
    if (g !== 5n || s !== 5n) bad++;
    lg = g; ls = s;
  }
  out("interleave.phase2.lastGrow", fmt(lg));
  out("interleave.phase2.lastSize", fmt(ls));
  out("interleave.phase2.badcount", String(bad));
  out("interleave.finalSize", fmt(size()));
}

// ---------------------------------------------------------------------------
// Module E: sum of memory.size over N iters inside wasm (checks full i64 math
// on the result, not just equality).
// ---------------------------------------------------------------------------
async function testSizeSum() {
  const inst = await make(`
    (module
      (memory i64 7)
      (func (export "sumSize") (param $n i64) (result i64)
        (local $i i64) (local $acc i64)
        (block $done
          (loop $l
            local.get $i local.get $n i64.ge_u br_if $done
            local.get $acc memory.size i64.add local.set $acc
            local.get $i i64.const 1 i64.add local.set $i
            br $l))
        local.get $acc)
    )`);
  const N = BigInt(ITER);
  const got = inst.exports.sumSize(N);
  out("sumSize.result", fmt(got));
  out("sumSize.expected", fmt(7n * N));
  out("sumSize.match", String(got === 7n * N));
}

// ---------------------------------------------------------------------------
// Drive.
// ---------------------------------------------------------------------------
try { await testJSLoop(); } catch (e) { out("jsloop.ERROR", String(e)); }
try { await testWasmLoop(); } catch (e) { out("wasmloop.ERROR", String(e)); }
try { await testEdgeDeltas(); } catch (e) { out("edge.ERROR", String(e)); }
try { await testInterleaved(); } catch (e) { out("interleave.ERROR", String(e)); }
try { await testSizeSum(); } catch (e) { out("sumSize.ERROR", String(e)); }
out("DONE", "ok");
