// Hunt: atomic RMW ops on memory64 with static offsets near 2^32 and 2^63,
// combined with runtime addresses that sum-overflow.
//
// Each test line prints: NAME<tab>RESULT
//   RESULT is one of:
//     TRAP                         - op raised WebAssembly.RuntimeError (expected for OOB/unaligned)
//     OK:ret=<v>                   - op returned <v> and effective addr was in-bounds & aligned (expected)
//     NOTRAP:ret=<v>,mem0=<m>      - op did NOT trap but effective addr was OOB/unaligned (BUG)
//     BADTRAP                      - op trapped but effective addr was in-bounds & aligned (BUG)
//     COMPILE_ERR:<msg>            - module failed to compile
//     ERR:<msg>                    - other error
//
// NAME is: <shared|unshared>/<op>/off=<offset>/addr=<addr>

import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

const WABT_OPTS = { memory64: true, threads: true, reference_types: true, bulk_memory: true, gc: true, exceptions: true };

const PAGE = 65536n;
const MEM_PAGES = 1n;
const MEM_BYTES = PAGE * MEM_PAGES;

// Offsets to bake as static immediates.
const OFFSETS = [
  { tag: "2^32-1", v: 4294967295n },
  { tag: "2^32",   v: 4294967296n },
  { tag: "2^63",   v: 9223372036854775808n },
  { tag: "2^64-1", v: 18446744073709551615n },
  // Alignment-friendly wrap-around probes: offset + small addr == 2^64 exactly.
  { tag: "2^64-8", v: 18446744073709551608n },
  { tag: "2^64-4", v: 18446744073709551612n },
];

// Runtime addresses.
const ADDRS = [
  0n, 1n,
  2147483647n,            // 2^31-1
  2147483648n,            // 2^31
  4294967295n,            // 2^32-1
  4294967296n,            // 2^32
  9223372036854775807n,   // 2^63-1
  9223372036854775808n,   // 2^63
  18446744073709551615n,  // 2^64-1
];

// RMW op descriptors.
// kind: "rmw" takes (ptr, val); "cmpxchg" takes (ptr, expected, replacement)
const OPS = [
  // full-width i32
  { name: "i32.atomic.rmw.add",      vt: "i32", sz: 4, kind: "rmw" },
  { name: "i32.atomic.rmw.sub",      vt: "i32", sz: 4, kind: "rmw" },
  { name: "i32.atomic.rmw.and",      vt: "i32", sz: 4, kind: "rmw" },
  { name: "i32.atomic.rmw.or",       vt: "i32", sz: 4, kind: "rmw" },
  { name: "i32.atomic.rmw.xor",      vt: "i32", sz: 4, kind: "rmw" },
  { name: "i32.atomic.rmw.xchg",     vt: "i32", sz: 4, kind: "rmw" },
  { name: "i32.atomic.rmw.cmpxchg",  vt: "i32", sz: 4, kind: "cmpxchg" },
  // full-width i64
  { name: "i64.atomic.rmw.add",      vt: "i64", sz: 8, kind: "rmw" },
  { name: "i64.atomic.rmw.sub",      vt: "i64", sz: 8, kind: "rmw" },
  { name: "i64.atomic.rmw.and",      vt: "i64", sz: 8, kind: "rmw" },
  { name: "i64.atomic.rmw.or",       vt: "i64", sz: 8, kind: "rmw" },
  { name: "i64.atomic.rmw.xor",      vt: "i64", sz: 8, kind: "rmw" },
  { name: "i64.atomic.rmw.xchg",     vt: "i64", sz: 8, kind: "rmw" },
  { name: "i64.atomic.rmw.cmpxchg",  vt: "i64", sz: 8, kind: "cmpxchg" },
  // sub-width i32
  { name: "i32.atomic.rmw8.add_u",     vt: "i32", sz: 1, kind: "rmw" },
  { name: "i32.atomic.rmw16.add_u",    vt: "i32", sz: 2, kind: "rmw" },
  { name: "i32.atomic.rmw8.xchg_u",    vt: "i32", sz: 1, kind: "rmw" },
  { name: "i32.atomic.rmw16.xchg_u",   vt: "i32", sz: 2, kind: "rmw" },
  { name: "i32.atomic.rmw8.cmpxchg_u", vt: "i32", sz: 1, kind: "cmpxchg" },
  { name: "i32.atomic.rmw16.cmpxchg_u",vt: "i32", sz: 2, kind: "cmpxchg" },
  // sub-width i64
  { name: "i64.atomic.rmw8.add_u",     vt: "i64", sz: 1, kind: "rmw" },
  { name: "i64.atomic.rmw16.add_u",    vt: "i64", sz: 2, kind: "rmw" },
  { name: "i64.atomic.rmw32.add_u",    vt: "i64", sz: 4, kind: "rmw" },
  { name: "i64.atomic.rmw8.xchg_u",    vt: "i64", sz: 1, kind: "rmw" },
  { name: "i64.atomic.rmw16.xchg_u",   vt: "i64", sz: 2, kind: "rmw" },
  { name: "i64.atomic.rmw32.xchg_u",   vt: "i64", sz: 4, kind: "rmw" },
  { name: "i64.atomic.rmw8.cmpxchg_u", vt: "i64", sz: 1, kind: "cmpxchg" },
  { name: "i64.atomic.rmw16.cmpxchg_u",vt: "i64", sz: 2, kind: "cmpxchg" },
  { name: "i64.atomic.rmw32.cmpxchg_u",vt: "i64", sz: 4, kind: "cmpxchg" },
];

function expected(addr, offset, sz) {
  // Effective address is infinite-precision addr+offset; if >= 2^64 it's OOB.
  const ea = addr + offset;
  if (ea + BigInt(sz) > MEM_BYTES) return "OOB";
  if (ea % BigInt(sz) !== 0n) return "UNALIGNED";
  return null; // in-bounds & aligned
}

function fmt(v) {
  if (typeof v === "bigint") return "0x" + v.toString(16) + "n";
  if (typeof v === "number") return "0x" + (v >>> 0).toString(16);
  return String(v);
}

let COUNT = 0;
function out(name, result) {
  COUNT++;
  print(name + "\t" + result);
}

async function buildModule(shared, op, offset) {
  const memDecl = shared
    ? `(memory (export "mem") i64 ${MEM_PAGES} ${MEM_PAGES} shared)`
    : `(memory (export "mem") i64 ${MEM_PAGES})`;
  const vt = op.vt;
  let body;
  if (op.kind === "cmpxchg") {
    body = `(func (export "run") (param i64 ${vt} ${vt}) (result ${vt})
              local.get 0 local.get 1 local.get 2 ${op.name} offset=${offset})`;
  } else {
    body = `(func (export "run") (param i64 ${vt}) (result ${vt})
              local.get 0 local.get 1 ${op.name} offset=${offset})`;
  }
  const wat = `(module
    ${memDecl}
    (func (export "st64") (param i64 i64) local.get 0 local.get 1 i64.store)
    (func (export "ld64") (param i64) (result i64) local.get 0 i64.load)
    ${body}
  )`;
  return await instantiate(wat, {}, WABT_OPTS);
}

async function runOp(sharedTag, shared, op, offTag, offset) {
  let inst;
  const pfx = `${sharedTag}/${op.name}/off=${offTag}`;
  try {
    inst = await buildModule(shared, op, offset);
  } catch (e) {
    const kind = (e instanceof WebAssembly.CompileError) ? "COMPILE_ERR" : "ERR";
    out(`${pfx}/addr=*`, `${kind}:${String(e).split("\n")[0].slice(0,120)}`);
    return;
  }
  const { run, st64, ld64 } = inst.exports;

  for (const addr of ADDRS) {
    // Re-seed sentinels each iteration so any stray write is observable.
    st64(0n, 0x1122334455667788n);
    st64(8n, 0x99AABBCCDDEEFF00n);

    const exp = expected(addr, offset, op.sz);
    let result;
    try {
      let ret;
      if (op.kind === "cmpxchg") {
        // expected=0 so that an in-bounds compare never matches sentinel -> no swap.
        ret = (op.vt === "i64") ? run(addr, 0n, 0x42n) : run(addr, 0, 0x42);
      } else {
        ret = (op.vt === "i64") ? run(addr, 0x42n) : run(addr, 0x42);
      }
      const m0 = ld64(0n);
      if (exp === null) {
        result = `OK:ret=${fmt(ret)}`;
      } else {
        result = `NOTRAP:ret=${fmt(ret)},mem0=${fmt(m0)}`;
      }
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) {
        const m0 = ld64(0n);
        const dirty = (m0 !== 0x1122334455667788n) ? `,DIRTY mem0=${fmt(m0)}` : "";
        if (exp === null) result = `BADTRAP${dirty}`;
        else result = `TRAP${dirty}`;
      } else {
        result = `ERR:${String(e).split("\n")[0].slice(0,120)}`;
      }
    }
    out(`${pfx}/addr=${addr}`, result);
  }
}

async function main() {
  for (const [sharedTag, shared] of [["shared", true], ["unshared", false]]) {
    for (const op of OPS) {
      for (const off of OFFSETS) {
        await runOp(sharedTag, shared, op, off.tag, off.v);
      }
    }
  }
  print(`# total tests: ${COUNT}`);
}

await main().catch(e => { print("FATAL\t" + e); throw e; });
