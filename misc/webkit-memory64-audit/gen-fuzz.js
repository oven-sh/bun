// Generative differential fuzzer for memory64.
// Generates WAT modules with edge-case memory ops, runs them, and
// outputs a deterministic log. Run under multiple tier configs and diff.

import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

const PAGE = 65536n;
const results = [];
function log(s) { results.push(s); }

function T(name, fn) {
  try {
    const r = fn();
    log(`${name}\tOK\t${r ?? ""}`);
  } catch (e) {
    if (e instanceof WebAssembly.RuntimeError)
      log(`${name}\tTRAP\t${e.message.split('(')[0].trim()}`);
    else if (e instanceof WebAssembly.CompileError)
      log(`${name}\tCOMPILE_ERR\t${e.message.slice(0, 80)}`);
    else
      log(`${name}\tERR\t${e.constructor.name}:${String(e).slice(0,60)}`);
  }
}

async function main() {
  // ============================================================
  // 1. Large static offsets (>32-bit) with various addresses
  // ============================================================
  const offsets = [
    "0x0", "0x1", "0x7F", "0x80", "0xFFFF", "0x10000",
    "0x7FFFFFFF", "0x80000000", "0xFFFFFFFF", "0x100000000",
    "0x100000001", "0x7FFFFFFFFFFFFFFF", "0x8000000000000000",
    "0xFFFFFFFFFFFFFFF8", "0xFFFFFFFFFFFFFFFF",
  ];
  for (const off of offsets) {
    const wat = `(module (memory i64 2)
      (func (export "f") (param i64) (result i32)
        local.get 0 i32.load offset=${off}))`;
    let inst;
    try { inst = await instantiate(wat, {}, { memory64: true }); }
    catch (e) { log(`static-off=${off}\tCOMPILE_ERR\t${String(e).slice(0,80)}`); continue; }
    const f = inst.exports.f;
    for (const a of [0n, 1n, 0x10000n, 0x80000000n, 0xFFFFFFFFn, 0x100000000n, 0xFFFFFFFFFFFFFFFFn]) {
      T(`off=${off}/addr=0x${a.toString(16)}`, () => f(a));
    }
  }

  // ============================================================
  // 2. Atomic ops with large offsets
  // ============================================================
  for (const off of ["0x0", "0x80", "0x7FFFFFFF", "0x80000000", "0xFFFFFFFF", "0x100000000", "0xFFFFFFFFFFFFFFFC"]) {
    const wat = `(module (memory i64 2 2 shared)
      (func (export "al") (param i64) (result i32)
        local.get 0 i32.atomic.load offset=${off})
      (func (export "ar") (param i64) (result i32)
        local.get 0 i32.const 1 i32.atomic.rmw.add offset=${off})
      (func (export "ac") (param i64) (result i32)
        local.get 0 i32.const 0 i32.const 1 i32.atomic.rmw.cmpxchg offset=${off})
      )`;
    let inst;
    try { inst = await instantiate(wat, {}, { memory64: true, threads: true }); }
    catch (e) { log(`atomic-off=${off}\tCOMPILE_ERR\t${String(e).slice(0,80)}`); continue; }
    for (const a of [0n, 4n, 0x80000000n, 0x100000000n, 0xFFFFFFFFFFFFFFFCn]) {
      T(`atomic.load/off=${off}/addr=0x${a.toString(16)}`, () => inst.exports.al(a));
      T(`atomic.add/off=${off}/addr=0x${a.toString(16)}`, () => inst.exports.ar(a));
      T(`atomic.cmpxchg/off=${off}/addr=0x${a.toString(16)}`, () => inst.exports.ac(a));
    }
  }

  // ============================================================
  // 3. Bulk memory with i64
  // ============================================================
  {
    const wat = `(module (memory i64 2)
      (data "hello")
      (func (export "init") (param i64 i32 i32)
        local.get 0 local.get 1 local.get 2 memory.init 0)
      (func (export "copy") (param i64 i64 i64)
        local.get 0 local.get 1 local.get 2 memory.copy)
      (func (export "fill") (param i64 i32 i64)
        local.get 0 local.get 1 local.get 2 memory.fill))`;
    const inst = await instantiate(wat, {}, { memory64: true, bulk_memory: true });
    const e = inst.exports;
    for (const [d,s,n] of [[0n,0,5],[0x1FFFBn,0,5],[0x1FFFCn,0,5],[0x100000000n,0,1],[0xFFFFFFFFFFFFFFFFn,0,0],[0xFFFFFFFFFFFFFFFFn,0,1]]) {
      T(`mem.init/${d},${s},${n}`, () => e.init(d, s, n));
    }
    for (const [d,s,n] of [[0n,0n,10n],[0x1FFF8n,0n,8n],[0x1FFF9n,0n,8n],[0n,0x100000000n,1n],[0xFFFFFFFFn,0n,0xFFFFFFFFn],[0n,0n,0x100000000n],[0xFFFFFFFFFFFFFFFFn,0n,1n]]) {
      T(`mem.copy/${d},${s},${n}`, () => e.copy(d,s,n));
    }
    for (const [d,v,n] of [[0n,0xAA,10n],[0x1FFF8n,1,8n],[0x1FFF9n,1,8n],[0n,1,0x100000000n],[0xFFFFFFFFFFFFFFFFn,1,1n],[0xFFFFFFFFFFFFFFFFn,1,0n]]) {
      T(`mem.fill/${d},${v},${n}`, () => e.fill(d,v,n));
    }
  }

  // ============================================================
  // 4. Data segment with i64 offset expression
  // ============================================================
  for (const off of ["0", "1", "65531", "65532", "65536", "131072", "0x100000000", "0xFFFFFFFFFFFFFFFF"]) {
    const wat = `(module (memory i64 1)
      (data (i64.const ${off}) "ABCDE"))`;
    T(`data-seg/off=${off}`, () => instantiate(wat, {}, { memory64: true }));
  }

  // ============================================================
  // 5. Table64 operations
  // ============================================================
  {
    const wat = `(module
      (table $t i64 10 funcref)
      (elem (table $t) (i64.const 0) funcref (ref.func $f))
      (type $ft (func (result i32)))
      (func $f (result i32) i32.const 42)
      (func (export "get") (param i64) (result funcref) local.get 0 table.get $t)
      (func (export "set") (param i64 funcref) local.get 0 local.get 1 table.set $t)
      (func (export "size") (result i64) table.size $t)
      (func (export "grow") (param i64) (result i64) ref.null func local.get 0 table.grow $t)
      (func (export "fill") (param i64 i64) local.get 0 ref.null func local.get 1 table.fill $t)
      (func (export "ci") (param i64) (result i32) local.get 0 call_indirect $t (type $ft))
      )`;
    let inst;
    try { inst = await instantiate(wat, {}, { memory64: true, reference_types: true }); }
    catch (e) { log(`table64\tCOMPILE_ERR\t${String(e).slice(0,100)}`); inst = null; }
    if (inst) {
      const e = inst.exports;
      T(`t64.size`, () => e.size());
      for (const i of [0n, 9n, 10n, 11n, 0x7FFFFFFFn, 0x80000000n, 0x100000000n, 0xFFFFFFFFFFFFFFFFn]) {
        T(`t64.get/${i}`, () => e.get(i));
        T(`t64.set/${i}`, () => e.set(i, null));
        T(`t64.ci/${i}`, () => e.ci(i));
      }
      for (const [o,n] of [[0n,5n],[5n,5n],[6n,5n],[0n,0x100000000n],[0x100000000n,0n],[0xFFFFFFFFFFFFFFFFn,1n]]) {
        T(`t64.fill/${o},${n}`, () => e.fill(o, n));
      }
      for (const n of [0n, 1n, 0x7FFFFFFFn, 0x80000000n, 0xFFFFFFFFFFFFFFFFn]) {
        T(`t64.grow/${n}`, () => e.grow(n));
      }
    }
  }

  // ============================================================
  // 6. memory.grow / memory.size with i64
  // ============================================================
  {
    const wat = `(module (memory i64 1 10)
      (func (export "size") (result i64) memory.size)
      (func (export "grow") (param i64) (result i64) local.get 0 memory.grow))`;
    const inst = await instantiate(wat, {}, { memory64: true });
    const e = inst.exports;
    T(`mem.size`, () => e.size());
    for (const n of [0n, 1n, 9n, 10n, 0x7FFFFFFFn, 0x80000000n, 0xFFFFFFFFn, 0x100000000n, 0xFFFFFFFFFFFFFFFFn]) {
      T(`mem.grow/${n}`, () => e.grow(n));
    }
  }

  print(results.join("\n"));
}

await main().catch(e => { print("FATAL: " + e.stack); $vm.abort(); });
