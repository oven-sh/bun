// Hunt for bugs in table.copy/table.init when mixing table64 and table32.
// Spec: https://webassembly.github.io/memory64/core/exec/instructions.html#table-instructions
//   - table.copy dst src: dstOffset has type idx(dst), srcOffset has type idx(src),
//     n has type min(idx(dst), idx(src)) (i32 if either is i32).
//   - OOB iff (srcOffset + n) > len(src) OR (dstOffset + n) > len(dst)  -- n=0 at OOB still traps.
//   - table.init: dstOffset has type idx(tbl), srcOffset i32, n i32.
//
// We check for truncation/overflow of i64 operands and for tier divergence.

import { instantiate, compile } from "../JSTests/wasm/wabt-wrapper.js";

const OPTS = { memory64: true, threads: true, reference_types: true, bulk_memory: true, gc: true, exceptions: true };

const lines = [];
function out(name, result) { lines.push(name + "\t" + result); }

function describe(e) {
  if (e instanceof WebAssembly.RuntimeError) return "TRAP:" + e.message.split("(")[0].trim();
  if (e instanceof WebAssembly.CompileError) return "COMPILE_ERR:" + String(e.message).slice(0, 90);
  if (e instanceof WebAssembly.LinkError)    return "LINK_ERR:" + String(e.message).slice(0, 90);
  return "ERR:" + (e && e.constructor ? e.constructor.name : "?") + ":" + String(e).slice(0, 90);
}

// i64 edge values (as BigInt)
const I64_EDGE = [
  0n, 1n, 9n, 10n, 11n,
  0x7FFF_FFFFn,              // 2^31-1
  0x8000_0000n,              // 2^31
  0xFFFF_FFFFn,              // 2^32-1
  0x1_0000_0000n,            // 2^32
  0x1_0000_0001n,            // 2^32+1
  0x1_0000_0009n,            // 2^32+9
  0x7FFF_FFFF_FFFF_FFFFn,    // 2^63-1
  -0x8000_0000_0000_0000n,   // 2^63 as signed wrap
  -1n,                       // 2^64-1 as signed wrap
];
// i32 edge values (as Number, passed to wasm i32 params — wrap to u32)
const I32_EDGE = [
  0, 1, 9, 10, 11,
  0x7FFF_FFFF,               // 2^31-1
  -0x8000_0000,              // 2^31 as signed i32
  -1,                        // 2^32-1 as signed i32
];

function hex(v) {
  if (typeof v === "bigint") {
    let u = v & 0xFFFF_FFFF_FFFF_FFFFn;
    return "0x" + u.toString(16);
  }
  return "0x" + (v >>> 0).toString(16);
}

//------------------------------------------------------------------
// Build one module with two tables (t64 at index 0, t32 at index 1),
// both size 10, plus a passive elem segment of size 4, plus 10
// marker funcs. Export the copy/init/get ops. Fresh instance per op
// so results are independent.
//------------------------------------------------------------------
const WAT = `
(module
  (table $t64 i64 10 funcref)
  (table $t32      10 funcref)

  ;; 10 marker funcs returning their index.
  ${Array.from({length:10}, (_,i)=>`(func $f${i} (result i32) i32.const ${i})`).join("\n  ")}

  ;; active elems initialise both tables so we can see overwrites.
  (elem (table $t64) (i64.const 0) funcref ${Array.from({length:10},(_,i)=>`(ref.func $f${i})`).join(" ")})
  (elem (table $t32) (i32.const 0) funcref ${Array.from({length:10},(_,i)=>`(ref.func $f${i})`).join(" ")})

  ;; passive elem for table.init (4 entries: f5..f8)
  (elem $p funcref (ref.func $f5) (ref.func $f6) (ref.func $f7) (ref.func $f8))

  ;; --- table.copy variants ---
  (func (export "copy_64_from_32") (param $d i64) (param $s i32) (param $n i32)
    local.get $d local.get $s local.get $n
    table.copy $t64 $t32)
  (func (export "copy_32_from_64") (param $d i32) (param $s i64) (param $n i32)
    local.get $d local.get $s local.get $n
    table.copy $t32 $t64)
  (func (export "copy_64_from_64") (param $d i64) (param $s i64) (param $n i64)
    local.get $d local.get $s local.get $n
    table.copy $t64 $t64)
  (func (export "copy_32_from_32") (param $d i32) (param $s i32) (param $n i32)
    local.get $d local.get $s local.get $n
    table.copy $t32 $t32)

  ;; --- table.init ---
  (func (export "init_64") (param $d i64) (param $s i32) (param $n i32)
    local.get $d local.get $s local.get $n
    table.init $t64 $p)
  (func (export "init_32") (param $d i32) (param $s i32) (param $n i32)
    local.get $d local.get $s local.get $n
    table.init $t32 $p)

  ;; --- readers (call_indirect so we get the marker int) ---
  (type $ri (func (result i32)))
  (func (export "get64") (param i64) (result i32)
    local.get 0 call_indirect $t64 (type $ri))
  (func (export "get32") (param i32) (result i32)
    local.get 0 call_indirect $t32 (type $ri))
)
`;

let MODULE;
async function freshInstance() {
  if (!MODULE) MODULE = await compile(WAT, OPTS);
  return new WebAssembly.Instance(MODULE, {});
}

function snapshot(inst, which) {
  const get = which === "t64" ? (i)=>inst.exports.get64(BigInt(i)) : (i)=>inst.exports.get32(i);
  let s = "";
  for (let i = 0; i < 10; i++) {
    try { s += String(get(i)); } catch (e) { s += "x"; }
  }
  return s;
}

async function run(name, fn) {
  let inst;
  try { inst = await freshInstance(); } catch (e) { out(name, "SETUP:" + describe(e)); return; }
  try {
    fn(inst);
    // After a successful op, capture both tables' contents.
    out(name, "OK:t64=" + snapshot(inst, "t64") + ",t32=" + snapshot(inst, "t32"));
  } catch (e) {
    out(name, describe(e));
  }
}

async function main() {
  // Sanity: initial contents.
  await run("sanity/initial", () => {});

  // ===========================================================
  // A) copy dst=t64 src=t32  (dst:i64, src:i32, n:i32)
  //    Probe truncation of i64 dst offset.
  // ===========================================================
  for (const d of I64_EDGE) {
    for (const n of [0, 1, 3]) {
      await run(`A.copy64<-32/d=${hex(d)}/s=0/n=${n}`,
        (inst) => inst.exports.copy_64_from_32(d, 0, n));
    }
  }
  // mix of dst + n interesting combos
  for (const d of [0n, 0x1_0000_0000n, -1n]) {
    for (const n of I32_EDGE) {
      await run(`A.copy64<-32/d=${hex(d)}/s=0/n=${hex(n)}`,
        (inst) => inst.exports.copy_64_from_32(d, 0, n));
    }
  }

  // ===========================================================
  // B) copy dst=t32 src=t64  (dst:i32, src:i64, n:i32)
  //    Probe truncation of i64 src offset.
  // ===========================================================
  for (const s of I64_EDGE) {
    for (const n of [0, 1, 3]) {
      await run(`B.copy32<-64/d=0/s=${hex(s)}/n=${n}`,
        (inst) => inst.exports.copy_32_from_64(0, s, n));
    }
  }
  for (const s of [0n, 0x1_0000_0000n, -1n]) {
    for (const n of I32_EDGE) {
      await run(`B.copy32<-64/d=0/s=${hex(s)}/n=${hex(n)}`,
        (inst) => inst.exports.copy_32_from_64(0, s, n));
    }
  }

  // ===========================================================
  // C) copy dst=t64 src=t64  (all i64) — reference behaviour.
  // ===========================================================
  for (const d of I64_EDGE) {
    await run(`C.copy64<-64/d=${hex(d)}/s=0/n=0`,
      (inst) => inst.exports.copy_64_from_64(d, 0n, 0n));
  }
  for (const n of I64_EDGE) {
    await run(`C.copy64<-64/d=0/s=0/n=${hex(n)}`,
      (inst) => inst.exports.copy_64_from_64(0n, 0n, n));
  }

  // ===========================================================
  // D) table.init on table64  (dst:i64, src:i32, n:i32)
  // ===========================================================
  for (const d of I64_EDGE) {
    for (const n of [0, 1, 4]) {
      await run(`D.init64/d=${hex(d)}/s=0/n=${n}`,
        (inst) => inst.exports.init_64(d, 0, n));
    }
  }
  for (const n of I32_EDGE) {
    await run(`D.init64/d=0/s=0/n=${hex(n)}`,
      (inst) => inst.exports.init_64(0n, 0, n));
  }
  for (const s of I32_EDGE) {
    await run(`D.init64/d=0/s=${hex(s)}/n=0`,
      (inst) => inst.exports.init_64(0n, s, 0));
  }

  // ===========================================================
  // E) "aliasing" probe — after a mixed copy with truncated dst,
  //    does the data land at the wrapped index? Explicit check.
  // ===========================================================
  for (const d of [0x1_0000_0000n, 0x1_0000_0005n, 0x2_0000_0000n]) {
    await run(`E.wrapcheck/copy64<-32/d=${hex(d)}/s=2/n=3`,
      (inst) => inst.exports.copy_64_from_32(d, 2, 3));
  }
  for (const s of [0x1_0000_0000n, 0x1_0000_0005n]) {
    await run(`E.wrapcheck/copy32<-64/d=0/s=${hex(s)}/n=3`,
      (inst) => inst.exports.copy_32_from_64(0, s, 3));
  }
  for (const d of [0x1_0000_0000n, 0x1_0000_0005n]) {
    await run(`E.wrapcheck/init64/d=${hex(d)}/s=0/n=4`,
      (inst) => inst.exports.init_64(d, 0, 4));
  }

  // ===========================================================
  // F) n=0 edge: spec says trap iff offset > len, even if n=0.
  //    So d=len (=10) with n=0 is OK, d=11 with n=0 traps.
  // ===========================================================
  for (const d of [9n, 10n, 11n]) {
    await run(`F.zerolen/copy64<-32/d=${hex(d)}/n=0`,
      (inst) => inst.exports.copy_64_from_32(d, 0, 0));
    await run(`F.zerolen/init64/d=${hex(d)}/n=0`,
      (inst) => inst.exports.init_64(d, 0, 0));
  }

  print(lines.join("\n"));
}

await main();
