// Hunt: All load/store widths at boundary addresses under memory64.
// Tests every load/store variant (i32.load8_s/u, load16_s/u, load; i64.load8/16/32_s/u, load;
// f32.load; f64.load; and all stores) at addresses near the end of memory and at
// extreme i64 values (0, 1, 2^31-1, 2^31, 2^32-1, 2^32, 2^63-1, 2^63, 2^64-1).
//
// Output: one line per test, "NAME<tab>RESULT", deterministic, for diffing across tiers.
// RESULT is one of: ok:<value>, TRAP, ERR:<name>, or MISMATCH:got=<x>,want=<y>.
//
// No SIMD (v128.*) — known broken with memory64.
// No multi-memory with memory64 — already blocked.

import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

const WABT_OPTS = {
  memory64: true,
  threads: true,
  reference_types: true,
  bulk_memory: true,
  gc: true,
  exceptions: true,
};

const U64_MASK = (1n << 64n) - 1n;

function out(name, result) {
  print(name + "\t" + result);
}

function fmt(v) {
  if (typeof v === "bigint") return "0x" + (v & U64_MASK).toString(16);
  if (typeof v === "number") {
    if (Object.is(v, -0)) return "-0";
    if (v !== v) return "NaN";
    return String(v);
  }
  return String(v);
}

function classify(e) {
  if (e instanceof WebAssembly.RuntimeError) return "TRAP";
  if (e instanceof WebAssembly.CompileError) return "COMPILE_ERR";
  if (e instanceof WebAssembly.LinkError) return "LINK_ERR";
  if (e instanceof RangeError) return "ERR:RangeError";
  if (e instanceof TypeError) return "ERR:TypeError";
  return "ERR:" + (e && e.constructor ? e.constructor.name : typeof e);
}

// All load ops: [name, wat-op, resultType, accessWidthBytes]
const LOADS = [
  ["i32.load8_s",  "i32.load8_s",  "i32", 1],
  ["i32.load8_u",  "i32.load8_u",  "i32", 1],
  ["i32.load16_s", "i32.load16_s", "i32", 2],
  ["i32.load16_u", "i32.load16_u", "i32", 2],
  ["i32.load",     "i32.load",     "i32", 4],
  ["i64.load8_s",  "i64.load8_s",  "i64", 1],
  ["i64.load8_u",  "i64.load8_u",  "i64", 1],
  ["i64.load16_s", "i64.load16_s", "i64", 2],
  ["i64.load16_u", "i64.load16_u", "i64", 2],
  ["i64.load32_s", "i64.load32_s", "i64", 4],
  ["i64.load32_u", "i64.load32_u", "i64", 4],
  ["i64.load",     "i64.load",     "i64", 8],
  ["f32.load",     "f32.load",     "f32", 4],
  ["f64.load",     "f64.load",     "f64", 8],
];

// All store ops: [name, wat-op, valueType, accessWidthBytes]
const STORES = [
  ["i32.store8",  "i32.store8",  "i32", 1],
  ["i32.store16", "i32.store16", "i32", 2],
  ["i32.store",   "i32.store",   "i32", 4],
  ["i64.store8",  "i64.store8",  "i64", 1],
  ["i64.store16", "i64.store16", "i64", 2],
  ["i64.store32", "i64.store32", "i64", 4],
  ["i64.store",   "i64.store",   "i64", 8],
  ["f32.store",   "f32.store",   "f32", 4],
  ["f64.store",   "f64.store",   "f64", 8],
];

// Build one module with every load/store exported as a function taking i64 address
// (and value for stores). Also versions with a few static offsets to probe the
// offset+addr overflow path.
function buildWat(pages) {
  let funcs = "";
  let idx = 0;
  const exportMap = {};

  for (const [name, op, rty, _w] of LOADS) {
    const fn = `ld${idx++}`;
    exportMap["L:" + name + ":off0"] = fn;
    funcs += `  (func (export "${fn}") (param i64) (result ${rty}) local.get 0 ${op})\n`;
  }
  for (const [name, op, vty, _w] of STORES) {
    const fn = `st${idx++}`;
    exportMap["S:" + name + ":off0"] = fn;
    funcs += `  (func (export "${fn}") (param i64 ${vty}) local.get 0 local.get 1 ${op})\n`;
  }

  // Static-offset variants. These are the boundary-crossing static offsets to
  // check off-by-one in the "offset + width" portion of the check. We cover
  // offset=1, offset=memSize-1, offset=memSize, offset=2^32-1, 2^32, 2^64-1.
  const PAGE = 65536n;
  const memBytes = BigInt(pages) * PAGE;
  const offs = [
    1n,
    memBytes - 1n,
    memBytes,
    0xFFFF_FFFFn,
    0x1_0000_0000n,
    0xFFFF_FFFF_FFFF_FFFFn,
  ];
  for (const off of offs) {
    for (const [name, op, rty, _w] of LOADS) {
      const fn = `ld${idx++}`;
      exportMap["L:" + name + ":off" + off.toString(10)] = fn;
      funcs += `  (func (export "${fn}") (param i64) (result ${rty}) local.get 0 ${op} offset=${off})\n`;
    }
    for (const [name, op, vty, _w] of STORES) {
      const fn = `st${idx++}`;
      exportMap["S:" + name + ":off" + off.toString(10)] = fn;
      funcs += `  (func (export "${fn}") (param i64 ${vty}) local.get 0 local.get 1 ${op} offset=${off})\n`;
    }
  }

  const wat = `(module\n  (memory (export "mem") i64 ${pages} ${pages})\n${funcs})`;
  return { wat, exportMap, offs };
}

function storeValue(vty) {
  switch (vty) {
    case "i32": return 0xA5A5A5A5 | 0;
    case "i64": return 0xA5A5A5A5A5A5A5A5n;
    case "f32": return 1.5;
    case "f64": return 1.5;
  }
}

// Semantics: trap iff (addr + off) overflows u64, or (addr + off + width) > memBytes.
function expectTrap(addr, off, width, memBytes) {
  const eff = (addr + off) & U64_MASK;
  if (eff < addr) return true; // addr+off wrapped u64
  const end = (eff + BigInt(width)) & U64_MASK;
  if (end < eff) return true; // eff+width wrapped u64
  return end > memBytes;
}

async function runForPages(pages) {
  const PAGE = 65536n;
  const memBytes = BigInt(pages) * PAGE;
  const { wat, exportMap, offs } = buildWat(pages);

  let inst;
  try {
    inst = await instantiate(wat, {}, WABT_OPTS);
  } catch (e) {
    out(`build/pages=${pages}`, classify(e) + ":" + String(e.message || e).slice(0, 160));
    return;
  }
  const ex = inst.exports;
  out(`build/pages=${pages}`, "ok:bytes=" + memBytes.toString());

  // Dynamic addresses to test: boundary addresses relative to memBytes, plus
  // the canonical i64 edge values.
  const addrs = [
    0n, 1n,
    memBytes - 8n, memBytes - 7n,
    memBytes - 4n, memBytes - 3n,
    memBytes - 2n, memBytes - 1n,
    memBytes,            // one past
    memBytes + 1n,
    0x7FFF_FFFFn,        // 2^31 - 1
    0x8000_0000n,        // 2^31
    0xFFFF_FFFFn,        // 2^32 - 1
    0x1_0000_0000n,      // 2^32
    0x7FFF_FFFF_FFFF_FFFFn, // 2^63 - 1
    0x8000_0000_0000_0000n, // 2^63
    0xFFFF_FFFF_FFFF_FFFFn, // 2^64 - 1
  ];

  const allOffs = [0n, ...offs];

  // Loads
  for (const off of allOffs) {
    for (const [name, _op, _rty, width] of LOADS) {
      const key = "L:" + name + ":off" + off.toString(10);
      const fn = ex[exportMap[key]];
      for (const a of addrs) {
        const want = expectTrap(a, off, width, memBytes) ? "TRAP" : "OK";
        let got;
        let detail = "";
        try {
          const v = fn(a);
          got = "OK";
          detail = "ok:" + fmt(v);
        } catch (e) {
          got = classify(e);
          detail = got;
        }
        const tag = got === want ? detail : `MISMATCH:got=${got},want=${want}`;
        out(`p${pages}/${name}/off=${off}/a=0x${a.toString(16)}`, tag);
      }
    }
  }

  // Stores
  for (const off of allOffs) {
    for (const [name, _op, vty, width] of STORES) {
      const key = "S:" + name + ":off" + off.toString(10);
      const fn = ex[exportMap[key]];
      const val = storeValue(vty);
      for (const a of addrs) {
        const want = expectTrap(a, off, width, memBytes) ? "TRAP" : "OK";
        let got;
        let detail = "";
        try {
          fn(a, val);
          got = "OK";
          detail = "ok:stored";
        } catch (e) {
          got = classify(e);
          detail = got;
        }
        const tag = got === want ? detail : `MISMATCH:got=${got},want=${want}`;
        out(`p${pages}/${name}/off=${off}/a=0x${a.toString(16)}`, tag);
      }
    }
  }

  // Off-by-one explicit grid: for each width W, addr = memBytes - W is the last
  // valid, addr = memBytes - W + 1 is the first invalid. Also do a store+load
  // roundtrip at memBytes - W to verify the valid case actually works.
  const gridWidths = [1, 2, 4, 8];
  for (const W of gridWidths) {
    const lastValid = memBytes - BigInt(W);
    const firstInvalid = lastValid + 1n;
    for (const [lname, _lop, lrty, lw] of LOADS) {
      if (lw !== W) continue;
      const lfn = ex[exportMap["L:" + lname + ":off0"]];
      // last valid
      {
        let r;
        try { r = "ok:" + fmt(lfn(lastValid)); } catch (e) { r = "MISMATCH:got=" + classify(e) + ",want=OK"; }
        out(`p${pages}/obo/${lname}/lastValid=0x${lastValid.toString(16)}`, r);
      }
      // first invalid
      {
        let r;
        try { lfn(firstInvalid); r = "MISMATCH:got=OK,want=TRAP"; } catch (e) { r = classify(e); }
        out(`p${pages}/obo/${lname}/firstInvalid=0x${firstInvalid.toString(16)}`, r);
      }
    }
    for (const [sname, _sop, svty, sw] of STORES) {
      if (sw !== W) continue;
      const sfn = ex[exportMap["S:" + sname + ":off0"]];
      const val = storeValue(svty);
      {
        let r;
        try { sfn(lastValid, val); r = "ok:stored"; } catch (e) { r = "MISMATCH:got=" + classify(e) + ",want=OK"; }
        out(`p${pages}/obo/${sname}/lastValid=0x${lastValid.toString(16)}`, r);
      }
      {
        let r;
        try { sfn(firstInvalid, val); r = "MISMATCH:got=OK,want=TRAP"; } catch (e) { r = classify(e); }
        out(`p${pages}/obo/${sname}/firstInvalid=0x${firstInvalid.toString(16)}`, r);
      }
    }
  }

  // Roundtrip at last-valid for each store width paired with matching-width load.
  const pairs = [
    ["i32.store8", "i32.load8_u", 1, 0xA5, v => (v & 0xFF)],
    ["i32.store16", "i32.load16_u", 2, 0xBEEF, v => (v & 0xFFFF)],
    ["i32.store", "i32.load", 4, (0xDEADBEEF | 0), v => (v | 0)],
    ["i64.store", "i64.load", 8, 0x1122334455667788n, v => v],
  ];
  for (const [sname, lname, W, sval, norm] of pairs) {
    const sfn = ex[exportMap["S:" + sname + ":off0"]];
    const lfn = ex[exportMap["L:" + lname + ":off0"]];
    const addr = memBytes - BigInt(W);
    let r;
    try {
      sfn(addr, sval);
      const got = lfn(addr);
      const ok = typeof sval === "bigint" ? (got === sval) : (norm(got) === norm(sval));
      r = ok ? "ok:" + fmt(got) : "MISMATCH:got=" + fmt(got) + ",want=" + fmt(sval);
    } catch (e) {
      r = "MISMATCH:got=" + classify(e) + ",want=OK";
    }
    out(`p${pages}/rt/${sname}->${lname}/a=0x${addr.toString(16)}`, r);
  }
}

async function main() {
  // pages=2 keeps memBytes=131072 (< 2^31 addresses), exercising the small-memory path.
  // pages=1 gives memBytes=65536 so memBytes-1 etc. are near a page boundary.
  await runForPages(1);
  await runForPages(2);
}

try {
  await main();
  print("DONE\tok");
} catch (e) {
  print("FATAL\t" + String(e && e.stack ? e.stack : e));
}
