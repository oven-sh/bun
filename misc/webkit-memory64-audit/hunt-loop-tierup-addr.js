// CATEGORY: Loop with i64 address arithmetic then load, forcing tier-up.
// A hot loop runs many iterations to force BBQ and OMG tier-up / loop-OSR.
// We then (A) perform a load at an i64 address computed via arithmetic after
// the loop, and (C) perform the arithmetic+load on the last loop iteration
// (so the i64 value is live across OSR). We check that the full 64-bit
// address is respected (OOB traps, in-bounds returns sentinel) after tier-up.
//
// Output is deterministic: one "NAME\tRESULT" line per test. Diff across
// configs (default/ipint/bbq/nofm/nojit) to find tier divergences.

import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

const WABT_OPTS = {
  memory64: true,
  threads: true,
  reference_types: true,
  bulk_memory: true,
  gc: true,
  exceptions: true,
};

// Loop trip counts. WARM should exceed OMG OSR threshold; HOT is the per-test
// inner-loop count for variant C.
const WARM = 300000n;
const HOT = 60000n;

const wat = `
(module
  (memory (export "mem") i64 2)
  ;; sentinels: mem[0..8) = 11 22 33 44 55 66 77 88
  ;;            mem[65536..65544) = aa bb cc dd ee ff 01 02
  (data (i64.const 0) "\\11\\22\\33\\44\\55\\66\\77\\88")
  (data (i64.const 65536) "\\aa\\bb\\cc\\dd\\ee\\ff\\01\\02")

  (table (export "tab") i64 8 funcref)
  (elem (i64.const 0) $tf0 $tf1 $tf2 $tf3)
  (func $tf0 (result i32) i32.const 1000)
  (func $tf1 (result i32) i32.const 1001)
  (func $tf2 (result i32) i32.const 1002)
  (func $tf3 (result i32) i32.const 1003)

  ;; ---------- Variant A: hot loop then arithmetic+load ----------
  ;; The loop just loads mem[0] to stay hot; the interesting load is after.

  (func (export "A_id") (param $a i64) (param $n i64) (result i32)
    (local $i i64)
    (loop $L
      i64.const 0 i32.load drop
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $a i32.load)

  (func (export "A_add") (param $a i64) (param $b i64) (param $n i64) (result i32)
    (local $i i64)
    (loop $L
      i64.const 0 i32.load drop
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $a local.get $b i64.add i32.load)

  (func (export "A_sub") (param $a i64) (param $b i64) (param $n i64) (result i32)
    (local $i i64)
    (loop $L
      i64.const 0 i32.load drop
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $a local.get $b i64.sub i32.load)

  (func (export "A_shl") (param $a i64) (param $b i64) (param $n i64) (result i32)
    (local $i i64)
    (loop $L
      i64.const 0 i32.load drop
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $a local.get $b i64.shl i32.load)

  (func (export "A_wrapext_u") (param $a i64) (param $n i64) (result i32)
    (local $i i64)
    (loop $L
      i64.const 0 i32.load drop
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $a i32.wrap_i64 i64.extend_i32_u i32.load)

  (func (export "A_wrapext_s") (param $a i64) (param $n i64) (result i32)
    (local $i i64)
    (loop $L
      i64.const 0 i32.load drop
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $a i32.wrap_i64 i64.extend_i32_s i32.load)

  (func (export "A_i64load") (param $a i64) (param $n i64) (result i64)
    (local $i i64)
    (loop $L
      i64.const 0 i32.load drop
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $a i64.load)

  (func (export "A_tabget") (param $a i64) (param $b i64) (param $n i64) (result funcref)
    (local $i i64)
    (loop $L
      i64.const 0 i32.load drop
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $a local.get $b i64.add table.get 0)

  ;; ---------- Variant C: arithmetic+load INSIDE the loop, last iter only ----------
  ;; select(arith(a,b), 0, is_last) so the i64 arithmetic result is live every
  ;; iteration (and thus across OSR), but only used as the load address on the
  ;; final iteration.

  (func (export "C_id") (param $a i64) (param $n i64) (result i32)
    (local $i i64) (local $r i32)
    (loop $L
      local.get $a
      i64.const 0
      local.get $i i64.const 1 i64.add local.get $n i64.eq
      select
      i32.load local.set $r
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $r)

  (func (export "C_add") (param $a i64) (param $b i64) (param $n i64) (result i32)
    (local $i i64) (local $r i32)
    (loop $L
      local.get $a local.get $b i64.add
      i64.const 0
      local.get $i i64.const 1 i64.add local.get $n i64.eq
      select
      i32.load local.set $r
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $r)

  (func (export "C_sub") (param $a i64) (param $b i64) (param $n i64) (result i32)
    (local $i i64) (local $r i32)
    (loop $L
      local.get $a local.get $b i64.sub
      i64.const 0
      local.get $i i64.const 1 i64.add local.get $n i64.eq
      select
      i32.load local.set $r
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $r)

  (func (export "C_shl") (param $a i64) (param $b i64) (param $n i64) (result i32)
    (local $i i64) (local $r i32)
    (loop $L
      local.get $a local.get $b i64.shl
      i64.const 0
      local.get $i i64.const 1 i64.add local.get $n i64.eq
      select
      i32.load local.set $r
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $r)

  (func (export "C_wrapext_u") (param $a i64) (param $n i64) (result i32)
    (local $i i64) (local $r i32)
    (loop $L
      local.get $a i32.wrap_i64 i64.extend_i32_u
      i64.const 0
      local.get $i i64.const 1 i64.add local.get $n i64.eq
      select
      i32.load local.set $r
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $r)

  (func (export "C_wrapext_s") (param $a i64) (param $n i64) (result i32)
    (local $i i64) (local $r i32)
    (loop $L
      local.get $a i32.wrap_i64 i64.extend_i32_s
      i64.const 0
      local.get $i i64.const 1 i64.add local.get $n i64.eq
      select
      i32.load local.set $r
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $r)

  ;; ---------- Variant D: loop-carried i64 address, load every iter ----------
  ;; addr is live across the back-edge. For OOB addresses this traps on the
  ;; first iteration (before tier-up); for in-bounds it exercises OSR with a
  ;; live i64 address local.

  (func (export "D_carry") (param $a i64) (param $n i64) (result i32)
    (local $i i64) (local $addr i64) (local $r i32)
    local.get $a local.set $addr
    (loop $L
      local.get $addr i64.const 0 i64.add local.tee $addr
      i32.load local.set $r
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $r)

  ;; ---------- Variant E: arithmetic inside loop every iter, addr always safe ----------
  ;; Computes (a+b) every iteration but ANDs with 0 so the load is at 0.
  ;; After the loop, uses the last computed (a+b) directly. Tests whether the
  ;; JIT incorrectly narrows (a+b) seeing it's always AND'd with 0 in the loop.

  (func (export "E_add_mask") (param $a i64) (param $b i64) (param $n i64) (result i32)
    (local $i i64) (local $sum i64)
    (loop $L
      local.get $a local.get $b i64.add local.tee $sum
      i64.const 0 i64.and
      i32.load drop
      local.get $i i64.const 1 i64.add local.tee $i
      local.get $n i64.lt_u br_if $L)
    local.get $sum i32.load)
)`;

let inst;
try {
  inst = await instantiate(wat, {}, WABT_OPTS);
} catch (err) {
  print("INSTANTIATE\tERR:" + String(err).slice(0, 200));
  throw err;
}
const e = inst.exports;

function hex32(v) { return "0x" + (v >>> 0).toString(16).padStart(8, "0"); }
function hex64(v) {
  let s = (v < 0n ? (v + (1n << 64n)) : v).toString(16);
  return "0x" + s.padStart(16, "0");
}

function run(name, fn, args, fmt) {
  let out;
  try {
    const r = fn(...args);
    out = fmt ? fmt(r) : hex32(r);
  } catch (err) {
    if (err instanceof WebAssembly.RuntimeError) out = "TRAP";
    else out = "ERR:" + String(err).slice(0, 100);
  }
  print(name + "\t" + out);
}

// Edge-case i64 values.
const EDGE = [
  ["0",        0n],
  ["1",        1n],
  ["64K",      0x0000_0000_0001_0000n],
  ["2^31-1",   0x0000_0000_7FFF_FFFFn],
  ["2^31",     0x0000_0000_8000_0000n],
  ["2^32-1",   0x0000_0000_FFFF_FFFFn],
  ["2^32",     0x0000_0001_0000_0000n],
  ["2^32+64K", 0x0000_0001_0001_0000n],
  ["2^63-1",   0x7FFF_FFFF_FFFF_FFFFn],
  ["2^63",     0x8000_0000_0000_0000n],
  ["2^64-1",   0xFFFF_FFFF_FFFF_FFFFn],
];

// -------- Warm every function so subsequent calls hit optimized tiers --------
const warmTargets = [
  ["A_id",        [0n, WARM]],
  ["A_add",       [0n, 0n, WARM]],
  ["A_sub",       [0n, 0n, WARM]],
  ["A_shl",       [0n, 0n, WARM]],
  ["A_wrapext_u", [0n, WARM]],
  ["A_wrapext_s", [0n, WARM]],
  ["A_i64load",   [0n, WARM]],
  ["A_tabget",    [0n, 0n, WARM]],
  ["C_id",        [0n, WARM]],
  ["C_add",       [0n, 0n, WARM]],
  ["C_sub",       [0n, 0n, WARM]],
  ["C_shl",       [0n, 0n, WARM]],
  ["C_wrapext_u", [0n, WARM]],
  ["C_wrapext_s", [0n, WARM]],
  ["D_carry",     [0n, WARM]],
  ["E_add_mask",  [0n, 0n, WARM]],
];
for (const [fname, args] of warmTargets) {
  try { e[fname](...args); } catch (err) {
    print("WARM/" + fname + "\tERR:" + String(err).slice(0, 100));
  }
}
print("WARM\tDONE");

// -------- Variant A (post-loop load; already tiered) --------
for (const [lbl, v] of EDGE) {
  run("A_id/" + lbl, e.A_id, [v, 1n]);
}
for (const [lbl, v] of EDGE) {
  run("A_add/(" + lbl + ",0)", e.A_add, [v, 0n, 1n]);
  run("A_add/(0," + lbl + ")", e.A_add, [0n, v, 1n]);
}
// add splits that sum to interesting boundaries
run("A_add/(2^31,2^31)",   e.A_add, [0x8000_0000n, 0x8000_0000n, 1n]);           // = 2^32
run("A_add/(2^32-1,1)",    e.A_add, [0xFFFF_FFFFn, 1n, 1n]);                     // = 2^32
run("A_add/(2^32,64K)",    e.A_add, [0x1_0000_0000n, 0x1_0000n, 1n]);            // = 2^32+64K
run("A_add/(2^63-1,1)",    e.A_add, [0x7FFF_FFFF_FFFF_FFFFn, 1n, 1n]);           // = 2^63
run("A_add/(2^64-1,1)",    e.A_add, [0xFFFF_FFFF_FFFF_FFFFn, 1n, 1n]);           // = 0 (wrap)
run("A_add/(2^64-1,64K+1)",e.A_add, [0xFFFF_FFFF_FFFF_FFFFn, 0x1_0001n, 1n]);    // = 64K (wrap)

for (const [lbl, v] of EDGE) {
  run("A_sub/(" + lbl + ",0)", e.A_sub, [v, 0n, 1n]);
}
run("A_sub/(0,1)",         e.A_sub, [0n, 1n, 1n]);                               // = 2^64-1
run("A_sub/(2^32,2^32)",   e.A_sub, [0x1_0000_0000n, 0x1_0000_0000n, 1n]);       // = 0
run("A_sub/(2^32+64K,2^32)", e.A_sub, [0x1_0001_0000n, 0x1_0000_0000n, 1n]);     // = 64K

for (const k of [0n, 1n, 16n, 31n, 32n, 33n, 48n, 63n]) {
  run("A_shl/(1," + k + ")", e.A_shl, [1n, k, 1n]);
}
run("A_shl/(64K,0)",  e.A_shl, [0x1_0000n, 0n, 1n]);
run("A_shl/(2^32,0)", e.A_shl, [0x1_0000_0000n, 0n, 1n]);
run("A_shl/(2,31)",   e.A_shl, [2n, 31n, 1n]);   // = 2^32
run("A_shl/(3,31)",   e.A_shl, [3n, 31n, 1n]);   // = 3*2^31

for (const [lbl, v] of EDGE) {
  run("A_wrapext_u/" + lbl, e.A_wrapext_u, [v, 1n]);
}
for (const [lbl, v] of EDGE) {
  run("A_wrapext_s/" + lbl, e.A_wrapext_s, [v, 1n]);
}
for (const [lbl, v] of EDGE) {
  run("A_i64load/" + lbl, e.A_i64load, [v, 1n], hex64);
}
for (const [lbl, v] of EDGE) {
  run("A_tabget/(" + lbl + ",0)", e.A_tabget, [v, 0n, 1n],
      r => r === null ? "null" : "func");
}
run("A_tabget/(2^32-1,1)", e.A_tabget, [0xFFFF_FFFFn, 1n, 1n], r => r === null ? "null" : "func");
run("A_tabget/(2^64-1,1)", e.A_tabget, [0xFFFF_FFFF_FFFF_FFFFn, 1n, 1n], r => r === null ? "null" : "func");

// -------- Variant C (in-loop select; HOT inner iters) --------
for (const [lbl, v] of EDGE) {
  run("C_id/" + lbl, e.C_id, [v, HOT]);
}
for (const [lbl, v] of EDGE) {
  run("C_add/(" + lbl + ",0)", e.C_add, [v, 0n, HOT]);
  run("C_add/(0," + lbl + ")", e.C_add, [0n, v, HOT]);
}
run("C_add/(2^31,2^31)",    e.C_add, [0x8000_0000n, 0x8000_0000n, HOT]);
run("C_add/(2^32-1,1)",     e.C_add, [0xFFFF_FFFFn, 1n, HOT]);
run("C_add/(2^64-1,1)",     e.C_add, [0xFFFF_FFFF_FFFF_FFFFn, 1n, HOT]);
run("C_add/(2^64-1,64K+1)", e.C_add, [0xFFFF_FFFF_FFFF_FFFFn, 0x1_0001n, HOT]);

for (const k of [0n, 1n, 16n, 31n, 32n, 33n, 48n, 63n]) {
  run("C_shl/(1," + k + ")", e.C_shl, [1n, k, HOT]);
}
run("C_shl/(2,31)", e.C_shl, [2n, 31n, HOT]);

for (const [lbl, v] of EDGE) {
  run("C_wrapext_u/" + lbl, e.C_wrapext_u, [v, HOT]);
}
for (const [lbl, v] of EDGE) {
  run("C_wrapext_s/" + lbl, e.C_wrapext_s, [v, HOT]);
}

for (const [lbl, v] of EDGE) {
  run("C_sub/(" + lbl + ",0)", e.C_sub, [v, 0n, HOT]);
}
run("C_sub/(0,1)", e.C_sub, [0n, 1n, HOT]);

// -------- Variant D (loop-carried addr) --------
for (const [lbl, v] of EDGE) {
  run("D_carry/" + lbl, e.D_carry, [v, HOT]);
}

// -------- Variant E (masked sum in loop, raw sum after) --------
for (const [lbl, v] of EDGE) {
  run("E_add_mask/(" + lbl + ",0)", e.E_add_mask, [v, 0n, HOT]);
}
run("E_add_mask/(2^31,2^31)", e.E_add_mask, [0x8000_0000n, 0x8000_0000n, HOT]);
run("E_add_mask/(2^32-1,1)",  e.E_add_mask, [0xFFFF_FFFFn, 1n, HOT]);

print("END\tOK");
