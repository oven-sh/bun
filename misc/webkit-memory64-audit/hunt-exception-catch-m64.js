// Hunt: memory64/table64 OOB access inside try_table and legacy try/catch.
// Traps are NOT exceptions; catch/catch_all/try_table must NOT intercept them.
// Each line: NAME<tab>RESULT. RESULT is TRAP, CAUGHT (bug for OOB), value, or ERR:msg.
// Also checks that a sentinel at memory[0] stays intact after each trap (no state corruption).
//
// Run from JSTests/wasm with: jsc --useDollarVM=1 -m ../../m64-fuzz/hunt-exception-catch-m64.js

import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

const WABT_OPTS = {
  memory64: true,
  threads: true,
  reference_types: true,
  bulk_memory: true,
  gc: true,
  exceptions: true,
};

const out = [];
function line(name, res) { out.push(name + "\t" + res); }

function classify(e) {
  if (e instanceof WebAssembly.RuntimeError) return "TRAP";
  if (e instanceof WebAssembly.Exception)   return "WASMEXN";
  return "ERR:" + (e && e.constructor ? e.constructor.name : typeof e) + ":" + String(e && e.message ? e.message : e).slice(0, 60);
}

// Edge-case i64 address set. Memory is 1 page (65536 bytes) so everything >= 65536 is OOB.
const ADDRS = [
  ["0",        0n],
  ["1",        1n],
  ["2^31-1",   0x7FFF_FFFFn],
  ["2^31",     0x8000_0000n],
  ["2^32-1",   0xFFFF_FFFFn],
  ["2^32",     0x1_0000_0000n],
  ["2^63-1",   0x7FFF_FFFF_FFFF_FFFFn],
  ["2^63",     0x8000_0000_0000_0000n],
  ["2^64-1",   0xFFFF_FFFF_FFFF_FFFFn],
];

// ---------------------------------------------------------------------------
// Module A: legacy try/catch_all around memory64 ops.
// Each func returns i32: -1 if the catch_all ran (BUG for OOB), else the
// loaded/probe value (or 0 for stores). Caller sees TRAP if trap escapes.
// ---------------------------------------------------------------------------
const WAT_LEGACY_MEM = `
(module
  (memory (export "mem") i64 1 1)
  (data (i64.const 0) "\\de\\ad\\be\\ef\\00\\00\\00\\00")
  (data $p "\\aa\\bb\\cc\\dd")
  (tag $e (param i32))

  ;; control: throw is catchable
  (func (export "ctl_throw") (result i32)
    (try (result i32)
      (do (throw $e (i32.const 7)) (i32.const 0))
      (catch $e)                           ;; pops i32 from tag
      (catch_all (i32.const -2))))

  (func (export "ld32") (param i64) (result i32)
    (try (result i32)
      (do (local.get 0) (i32.load))
      (catch_all (i32.const -1))))

  (func (export "ld32_off1") (param i64) (result i32)
    (try (result i32)
      (do (local.get 0) (i32.load offset=1))
      (catch_all (i32.const -1))))

  (func (export "ld32_bigoff") (param i64) (result i32)
    (try (result i32)
      (do (local.get 0) (i32.load offset=0xffffffffffffffff))
      (catch_all (i32.const -1))))

  (func (export "ld64") (param i64) (result i64)
    (try (result i64)
      (do (local.get 0) (i64.load))
      (catch_all (i64.const -1))))

  (func (export "st32") (param i64) (result i32)
    (try (result i32)
      (do (local.get 0) (i32.const 305419896) (i32.store) (i32.const 0))
      (catch_all (i32.const -1))))

  (func (export "ald32") (param i64) (result i32)
    (try (result i32)
      (do (local.get 0) (i32.atomic.load))
      (catch_all (i32.const -1))))

  (func (export "armw32") (param i64) (result i32)
    (try (result i32)
      (do (local.get 0) (i32.const 0) (i32.atomic.rmw.add))
      (catch_all (i32.const -1))))

  (func (export "mfill") (param i64) (result i32)
    (try (result i32)
      (do (local.get 0) (i32.const 0) (i64.const 16) (memory.fill) (i32.const 0))
      (catch_all (i32.const -1))))

  (func (export "mcopy") (param i64) (result i32)
    (try (result i32)
      (do (local.get 0) (i64.const 0) (i64.const 16) (memory.copy) (i32.const 0))
      (catch_all (i32.const -1))))

  (func (export "minit") (param i64) (result i32)
    (try (result i32)
      (do (local.get 0) (i32.const 0) (i32.const 4) (memory.init $p) (i32.const 0))
      (catch_all (i32.const -1))))

  ;; Sentinel re-read (no try): confirm mem[0] still 0xEFBEADDE after traps.
  (func (export "sentinel") (result i32) (i64.const 0) (i32.load))
  (func (export "reset") (i64.const 0) (i64.const 0x00000000efbeadde) (i64.store))
)`;

// ---------------------------------------------------------------------------
// Module B: try_table (catch_all) around memory64 ops.
// ---------------------------------------------------------------------------
const WAT_TT_MEM = `
(module
  (memory (export "mem") i64 1 1)
  (data (i64.const 0) "\\de\\ad\\be\\ef\\00\\00\\00\\00")
  (data $p "\\aa\\bb\\cc\\dd")
  (tag $e (param i32))

  (func (export "ctl_throw") (result i32)
    (block $h
      (try_table (catch_all $h)
        (throw $e (i32.const 7)))
      (return (i32.const 0)))
    (i32.const -1))

  (func (export "ld32") (param i64) (result i32)
    (block $h
      (return
        (try_table (result i32) (catch_all $h)
          (local.get 0) (i32.load))))
    (i32.const -1))

  (func (export "ld32_off1") (param i64) (result i32)
    (block $h
      (return
        (try_table (result i32) (catch_all $h)
          (local.get 0) (i32.load offset=1))))
    (i32.const -1))

  (func (export "ld32_bigoff") (param i64) (result i32)
    (block $h
      (return
        (try_table (result i32) (catch_all $h)
          (local.get 0) (i32.load offset=0xffffffffffffffff))))
    (i32.const -1))

  (func (export "ld64") (param i64) (result i64)
    (block $h
      (return
        (try_table (result i64) (catch_all $h)
          (local.get 0) (i64.load))))
    (i64.const -1))

  (func (export "st32") (param i64) (result i32)
    (block $h
      (try_table (catch_all $h)
        (local.get 0) (i32.const 305419896) (i32.store))
      (return (i32.const 0)))
    (i32.const -1))

  (func (export "ald32") (param i64) (result i32)
    (block $h
      (return
        (try_table (result i32) (catch_all $h)
          (local.get 0) (i32.atomic.load))))
    (i32.const -1))

  (func (export "armw32") (param i64) (result i32)
    (block $h
      (return
        (try_table (result i32) (catch_all $h)
          (local.get 0) (i32.const 0) (i32.atomic.rmw.add))))
    (i32.const -1))

  (func (export "mfill") (param i64) (result i32)
    (block $h
      (try_table (catch_all $h)
        (local.get 0) (i32.const 0) (i64.const 16) (memory.fill))
      (return (i32.const 0)))
    (i32.const -1))

  (func (export "mcopy") (param i64) (result i32)
    (block $h
      (try_table (catch_all $h)
        (local.get 0) (i64.const 0) (i64.const 16) (memory.copy))
      (return (i32.const 0)))
    (i32.const -1))

  (func (export "minit") (param i64) (result i32)
    (block $h
      (try_table (catch_all $h)
        (local.get 0) (i32.const 0) (i32.const 4) (memory.init $p))
      (return (i32.const 0)))
    (i32.const -1))

  (func (export "sentinel") (result i32) (i64.const 0) (i32.load))
  (func (export "reset") (i64.const 0) (i64.const 0x00000000efbeadde) (i64.store))
)`;

// ---------------------------------------------------------------------------
// Module C: legacy try around table64 ops (table.get/set/call_indirect).
// Table has 2 funcref slots; everything >=2 is OOB.
// ---------------------------------------------------------------------------
const WAT_LEGACY_TAB = `
(module
  (type $ft (func (result i32)))
  (table $t i64 2 2 funcref)
  (elem (i64.const 0) $f0 $f1)
  (tag $e)
  (func $f0 (result i32) (i32.const 100))
  (func $f1 (result i32) (i32.const 101))

  (func (export "tget") (param i64) (result i32)
    (try (result i32)
      (do (drop (table.get $t (local.get 0))) (i32.const 0))
      (catch_all (i32.const -1))))

  (func (export "tset") (param i64) (result i32)
    (try (result i32)
      (do (table.set $t (local.get 0) (ref.func $f0)) (i32.const 0))
      (catch_all (i32.const -1))))

  (func (export "tcall") (param i64) (result i32)
    (try (result i32)
      (do (call_indirect $t (type $ft) (local.get 0)))
      (catch_all (i32.const -1))))
)`;

// ---------------------------------------------------------------------------
// Module D: try_table around table64 ops.
// ---------------------------------------------------------------------------
const WAT_TT_TAB = `
(module
  (type $ft (func (result i32)))
  (table $t i64 2 2 funcref)
  (elem (i64.const 0) $f0 $f1)
  (tag $e)
  (func $f0 (result i32) (i32.const 100))
  (func $f1 (result i32) (i32.const 101))

  (func (export "tget") (param i64) (result i32)
    (block $h
      (try_table (catch_all $h)
        (drop (table.get $t (local.get 0))))
      (return (i32.const 0)))
    (i32.const -1))

  (func (export "tset") (param i64) (result i32)
    (block $h
      (try_table (catch_all $h)
        (table.set $t (local.get 0) (ref.func $f0)))
      (return (i32.const 0)))
    (i32.const -1))

  (func (export "tcall") (param i64) (result i32)
    (block $h
      (return
        (try_table (result i32) (catch_all $h)
          (call_indirect $t (type $ft) (local.get 0)))))
    (i32.const -1))
)`;

// ---------------------------------------------------------------------------
// Module E: nested (try_table inside legacy try_table) wrapping memory64 load.
// ---------------------------------------------------------------------------
const WAT_NESTED = `
(module
  (memory i64 1 1)
  (tag $e)
  (func (export "ld32") (param i64) (result i32)
    (block $o
      (try_table (catch_all $o)
        (block $i
          (return
            (try_table (result i32) (catch_all $i)
              (local.get 0) (i32.load))))
        (return (i32.const -2)))  ;; inner caught
      (unreachable))
    (i32.const -1))               ;; outer caught
)`;

function caughtMarker(v) {
  // -1 / -2 mean catch-handler ran.
  return v === -1 || v === -2 || v === -1n || v === -2n;
}

async function runMemSuite(label, wat, ops) {
  let inst;
  try {
    inst = await instantiate(wat, {}, WABT_OPTS);
  } catch (e) {
    line(label + ".instantiate", "ERR:" + String(e).slice(0, 120));
    return;
  }
  const ex = inst.exports;

  // control: real throw must be caught
  if (ex.ctl_throw) {
    try {
      const v = ex.ctl_throw();
      line(label + ".ctl_throw", caughtMarker(v) ? "CAUGHT" : String(v));
    } catch (e) { line(label + ".ctl_throw", classify(e)); }
  }

  const SENTINEL = -272716322; // 0xEFBEADDE as signed i32

  for (const op of ops) {
    for (const [an, a] of ADDRS) {
      if (ex.reset) ex.reset();
      let res;
      try {
        const v = ex[op](a);
        res = caughtMarker(v) ? "CAUGHT" : String(v);
      } catch (e) {
        res = classify(e);
      }
      line(label + "." + op + "[" + an + "]", res);

      // Only meaningful when the op trapped: a trap must not have scribbled memory.
      if (ex.sentinel && res === "TRAP") {
        let s;
        try { s = ex.sentinel(); } catch (e) { s = classify(e); }
        if (s !== SENTINEL)
          line(label + ".sentinel_after_" + op + "[" + an + "]", "CHANGED:" + String(s));
      }
    }
  }
}

async function runTabSuite(label, wat) {
  let inst;
  try {
    inst = await instantiate(wat, {}, WABT_OPTS);
  } catch (e) {
    line(label + ".instantiate", "ERR:" + String(e).slice(0, 120));
    return;
  }
  const ex = inst.exports;
  const ops = ["tget", "tset", "tcall"];
  for (const op of ops) {
    for (const [an, a] of ADDRS) {
      let res;
      try {
        const v = ex[op](a);
        res = caughtMarker(v) ? "CAUGHT" : String(v);
      } catch (e) {
        res = classify(e);
      }
      line(label + "." + op + "[" + an + "]", res);
    }
  }
}

async function main() {
  const memOps = ["ld32","ld32_off1","ld32_bigoff","ld64","st32","ald32","armw32","mfill","mcopy","minit"];
  await runMemSuite("legacy.mem", WAT_LEGACY_MEM, memOps);
  await runMemSuite("tt.mem",     WAT_TT_MEM,     memOps);
  await runMemSuite("nested.mem", WAT_NESTED,     ["ld32"]);
  await runTabSuite("legacy.tab", WAT_LEGACY_TAB);
  await runTabSuite("tt.tab",     WAT_TT_TAB);
  print(out.join("\n"));
}

await main();
