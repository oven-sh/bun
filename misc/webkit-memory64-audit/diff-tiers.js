// Differential test: memory64 load/store/atomic across edge-case addresses
// Each function is called with a specific address; we check that the result
// (value or trap) matches expectations consistently.
// Run this under multiple tier configs and diff outputs.

import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

const PAGE = 65536n;
const results = [];
function log(s) { results.push(s); }

async function run() {
  const wat = `
    (module
      (memory i64 2 2)  ;; 2 pages = 128KB, fixed
      (func (export "st8")  (param i64 i32) local.get 0 local.get 1 i32.store8)
      (func (export "ld8")  (param i64) (result i32) local.get 0 i32.load8_u)
      (func (export "st32") (param i64 i32) local.get 0 local.get 1 i32.store)
      (func (export "ld32") (param i64) (result i32) local.get 0 i32.load)
      (func (export "st64") (param i64 i64) local.get 0 local.get 1 i64.store)
      (func (export "ld64") (param i64) (result i64) local.get 0 i64.load)
      (func (export "ld32_off") (param i64) (result i32) local.get 0 i32.load offset=65536)
      (func (export "ld32_bigoff") (param i64) (result i32) local.get 0 i32.load offset=0xFFFFFFFF)
      (func (export "ld32_hugeoff") (param i64) (result i32) local.get 0 i32.load offset=0xFFFFFFFFFFFFFFFF)
      ;; Atomics (non-shared memory is ok for load/store, rmw)
      (func (export "ald32") (param i64) (result i32) local.get 0 i32.atomic.load)
      (func (export "ast32") (param i64 i32) local.get 0 local.get 1 i32.atomic.store)
      (func (export "armw32") (param i64 i32) (result i32) local.get 0 local.get 1 i32.atomic.rmw.add)
    )`;
  const inst = await instantiate(wat, {}, { memory64: true, threads: true, simd: true });
  const e = inst.exports;

  const SIZE = 2n * PAGE; // 131072
  const addrs = [
    0n, 1n, 4n, 8n,
    SIZE - 16n, SIZE - 8n, SIZE - 4n, SIZE - 1n, SIZE,
    SIZE + 1n,
    0x7FFFFFFFn, 0x80000000n, 0xFFFFFFFCn, 0xFFFFFFFFn,
    0x100000000n, 0x100000004n,
    0x7FFFFFFFFFFFFFFFn, 0x8000000000000000n,
    0xFFFFFFFFFFFFFFF0n, 0xFFFFFFFFFFFFFFFCn, 0xFFFFFFFFFFFFFFFFn,
  ];

  const ops = [
    ["ld8", a => e.ld8(a), 1],
    ["ld32", a => e.ld32(a), 4],
    ["ld64", a => e.ld64(a), 8],
    ["ld32_off", a => e.ld32_off(a), 4, 65536n],
    ["ld32_bigoff", a => e.ld32_bigoff(a), 4, 0xFFFFFFFFn],
    ["ld32_hugeoff", a => e.ld32_hugeoff(a), 4, 0xFFFFFFFFFFFFFFFFn],
    ["ald32", a => e.ald32(a), 4],
    ["armw32", a => e.armw32(a, 0), 4],
    ["st8", a => (e.st8(a, 0xAB), 'ok'), 1],
    ["st32", a => (e.st32(a, 0x12345678), 'ok'), 4],
    ["st64", a => (e.st64(a, 0x1122334455667788n), 'ok'), 8],
    ["ast32", a => (e.ast32(a, 0xCC), 'ok'), 4],
  ];

  for (const [name, fn, width, off] of ops) {
    for (const a of addrs) {
      let r;
      try {
        r = String(fn(a));
      } catch (err) {
        if (err instanceof WebAssembly.RuntimeError)
          r = "TRAP:" + err.message.split(':')[0].split('(')[0].trim();
        else
          r = "ERR:" + err.constructor.name;
      }
      // Compute expected: effective = a + (off||0); trap iff eff + width > SIZE or overflow
      const offv = off || 0n;
      let eff = a + offv;
      let overflow = eff < a; // u64 wrap
      let expected;
      if (overflow || eff > SIZE - BigInt(width)) expected = "trap";
      else expected = "ok";
      const got = r.startsWith("TRAP") ? "trap" : "ok";
      log(`${name}\t0x${a.toString(16)}\t${r}\t${got===expected?"":"MISMATCH:expected="+expected}`);
    }
  }
}

await run();
print(results.join("\n"));
