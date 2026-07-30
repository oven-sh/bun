// Hunt: call_indirect / return_call_indirect on table64 with huge i64 indices.
// Probe for index-truncation-before-bounds-check bugs.
//
// Each test prints: NAME<tab>RESULT where RESULT is the return value or
// "TRAP:<msg>" / "ERR:<cls>:<msg>".

import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

const wabtOpts = {
  memory64: true,
  threads: true,
  reference_types: true,
  bulk_memory: true,
  gc: true,
  exceptions: true,
  tail_call: true,
};

const out = [];
function rec(name, res) { out.push(name + "\t" + res); }

function asResult(fn) {
  try {
    const v = fn();
    return String(v);
  } catch (e) {
    if (e instanceof WebAssembly.RuntimeError)
      return "TRAP:" + String(e.message).split("(")[0].trim();
    return "ERR:" + (e && e.constructor ? e.constructor.name : typeof e) + ":" + String(e && e.message ? e.message : e).split("\n")[0];
  }
}

// Edge-case i64 index values. For a table of size 4 (valid indices 0..3),
// everything >=4 must trap. Watch especially for values whose low-32 bits land
// in-range (e.g. 2^32+1 -> low32==1).
const IDX = [
  ["0",          0n],
  ["1",          1n],
  ["3",          3n],               // last valid
  ["4",          4n],               // first OOB
  ["2^31-1",     0x7fffffffn],
  ["2^31",       0x80000000n],
  ["2^32-1",     0xffffffffn],
  ["2^32",       0x100000000n],     // low32==0
  ["2^32+1",     0x100000001n],     // low32==1
  ["2^32+3",     0x100000003n],     // low32==3
  ["2^33",       0x200000000n],
  ["2^63-1",     0x7fffffffffffffffn],
  ["2^63",       0x8000000000000000n], // i64-negative
  ["2^63+1",     0x8000000000000001n], // i64-negative, low32==1
  ["2^64-4",     0xfffffffffffffffcn],
  ["2^64-1",     0xffffffffffffffffn], // -1 as i64
];

// --- module factory ---------------------------------------------------------
// variant:
//   tbl:      "fixed"   -> (table i64 4 4 funcref)
//             "grow"    -> (table i64 4   funcref)
//             "second"  -> two tables, index 1 is the i64 one (exercises non-zero tableIndex path)
//   constIdx: if not null, hard-code the index in the wasm body (tests the
//             const-folding path in BBQ/OMG); else take it from param 0.
function makeWat({ tbl, constIdx }) {
  const tables =
    tbl === "fixed"  ? `(table $t i64 4 4 funcref)` :
    tbl === "grow"   ? `(table $t i64 4   funcref)` :
    /* second */       `(table $pad 1 1 funcref)\n  (table $t i64 4 4 funcref)`;

  const idxExpr = constIdx === null ? `local.get $i` : `i64.const ${constIdx}`;

  return `
(module
  (type $sig (func (result i32)))
  ${tables}
  (memory i64 1)

  (func $f0 (result i32) i32.const 100)
  (func $f1 (result i32) i32.const 101)
  (func $f2 (result i32) i32.const 102)
  (func $f3 (result i32) i32.const 103)
  (elem (table $t) (i64.const 0) func $f0 $f1 $f2 $f3)

  ;; direct call_indirect
  (func (export "ci") (param $i i64) (result i32)
    (call_indirect $t (type $sig) (${idxExpr})))

  ;; wrapper that invokes return_call_indirect in a callee
  (func $tail (param $i i64) (result i32)
    (return_call_indirect $t (type $sig) (${idxExpr})))
  (func (export "rci") (param $i i64) (result i32)
    (call $tail (local.get $i)))
)`;
}

async function buildAndRun(label, tbl, constIdx) {
  let inst;
  try {
    inst = await instantiate(makeWat({ tbl, constIdx }), {}, wabtOpts);
  } catch (e) {
    rec(`${label}/build`, "ERR:" + (e && e.constructor ? e.constructor.name : typeof e) + ":" + String(e && e.message ? e.message : e).split("\n")[0]);
    return;
  }
  const { ci, rci } = inst.exports;

  if (constIdx === null) {
    for (const [n, v] of IDX) {
      rec(`${label}/ci[${n}]`,  asResult(() => ci(v)));
      rec(`${label}/rci[${n}]`, asResult(() => rci(v)));
    }
  } else {
    // Constant-baked index: param is ignored, just call once.
    rec(`${label}/ci`,  asResult(() => ci(0n)));
    rec(`${label}/rci`, asResult(() => rci(0n)));
  }
}

async function main() {
  // dynamic-index variants over all table shapes
  await buildAndRun("dyn/fixed",  "fixed",  null);
  await buildAndRun("dyn/grow",   "grow",   null);
  await buildAndRun("dyn/second", "second", null);

  // constant-index variants (exercise isConst() path): one module per index.
  for (const [n, v] of IDX) {
    await buildAndRun(`const/fixed[${n}]`,  "fixed",  v.toString());
    await buildAndRun(`const/grow[${n}]`,   "grow",   v.toString());
    await buildAndRun(`const/second[${n}]`, "second", v.toString());
  }

  // Tier-up: run ci/rci in a hot loop on valid indices, then retest all IDX.
  // This forces BBQ/OMG compilation of the exact function we're probing.
  for (const tbl of ["fixed", "grow", "second"]) {
    let inst;
    try {
      inst = await instantiate(makeWat({ tbl, constIdx: null }), {}, wabtOpts);
    } catch (e) {
      rec(`hot/${tbl}/build`, "ERR:" + String(e && e.message ? e.message : e).split("\n")[0]);
      continue;
    }
    const { ci, rci } = inst.exports;
    // warm up
    for (let i = 0; i < 20000; i++) {
      ci(BigInt(i & 3));
      rci(BigInt(i & 3));
    }
    for (const [n, v] of IDX) {
      rec(`hot/${tbl}/ci[${n}]`,  asResult(() => ci(v)));
      rec(`hot/${tbl}/rci[${n}]`, asResult(() => rci(v)));
    }
  }

  // Imported table64 (fixed size) + call_indirect with extra args on stack.
  {
    const provider = await instantiate(`
      (module
        (table (export "t") i64 4 4 funcref)
        (func $f0 (param i32 i64) (result i32) local.get 0)
        (func $f1 (param i32 i64) (result i32) i32.const 201)
        (func $f2 (param i32 i64) (result i32) i32.const 202)
        (func $f3 (param i32 i64) (result i32) i32.const 203)
        (elem (i64.const 0) func $f0 $f1 $f2 $f3)
      )`, {}, wabtOpts);
    const inst = await instantiate(`
      (module
        (type $sig (func (param i32 i64) (result i32)))
        (import "m" "t" (table $t i64 4 4 funcref))
        (func (export "ci") (param $i i64) (result i32)
          (call_indirect $t (type $sig) (i32.const 777) (i64.const 0) (local.get $i)))
        (func $tail (param $i i64) (result i32)
          (return_call_indirect $t (type $sig) (i32.const 888) (i64.const 0) (local.get $i)))
        (func (export "rci") (param $i i64) (result i32)
          (call $tail (local.get $i)))
      )`, { m: { t: provider.exports.t } }, wabtOpts);
    for (const [n, v] of IDX) {
      rec(`import/ci[${n}]`,  asResult(() => inst.exports.ci(v)));
      rec(`import/rci[${n}]`, asResult(() => inst.exports.rci(v)));
    }
    // warm then retest
    for (let i = 0; i < 20000; i++) { inst.exports.ci(BigInt(i & 3)); inst.exports.rci(BigInt(i & 3)); }
    for (const [n, v] of IDX) {
      rec(`import-hot/ci[${n}]`,  asResult(() => inst.exports.ci(v)));
      rec(`import-hot/rci[${n}]`, asResult(() => inst.exports.rci(v)));
    }
  }

  // Extra: table64 of size 0 -> every index OOB, including 0.
  try {
    const inst = await instantiate(`
      (module
        (type $sig (func (result i32)))
        (table $t i64 0 funcref)
        (func (export "ci") (param $i i64) (result i32)
          (call_indirect $t (type $sig) (local.get $i)))
        (func $tail (param $i i64) (result i32)
          (return_call_indirect $t (type $sig) (local.get $i)))
        (func (export "rci") (param $i i64) (result i32)
          (call $tail (local.get $i)))
      )`, {}, wabtOpts);
    for (const [n, v] of IDX) {
      rec(`empty/ci[${n}]`,  asResult(() => inst.exports.ci(v)));
      rec(`empty/rci[${n}]`, asResult(() => inst.exports.rci(v)));
    }
  } catch (e) {
    rec("empty/build", "ERR:" + String(e && e.message ? e.message : e).split("\n")[0]);
  }

  print(out.join("\n"));
}

await main();
