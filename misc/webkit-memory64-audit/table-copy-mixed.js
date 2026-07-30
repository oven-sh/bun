// table.copy between table64 and table32 (and vice versa)
// Per spec: dst offset is dst's addr type, src offset is src's addr type,
// n is min(dst_addr_type, src_addr_type) i.e., i32 if either is i32.
import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

async function T(label, fn) {
  try {
    const r = await fn();
    print(`${label}\tOK\t${r ?? ""}`);
  } catch (e) {
    const kind = e instanceof WebAssembly.RuntimeError ? "TRAP"
               : e instanceof WebAssembly.CompileError ? "COMPILE_ERR"
               : "ERR";
    print(`${label}\t${kind}\t${String(e.message || e).slice(0,120)}`);
  }
}

// dst=64, src=32: copy(i64 d, i32 s, i32 n)
const wat1 = `
(module
  (table $t64 i64 10 funcref)
  (table $t32 10 funcref)
  (func $f (result i32) i32.const 42)
  (elem (table $t32) (i32.const 0) func $f $f $f $f $f)
  (func (export "copy_64_32") (param i64 i32 i32)
    local.get 0 local.get 1 local.get 2 table.copy $t64 $t32)
  (func (export "copy_32_64") (param i32 i64 i32)
    local.get 0 local.get 1 local.get 2 table.copy $t32 $t64)
  (func (export "get64") (param i64) (result funcref) local.get 0 table.get $t64)
  (func (export "get32") (param i32) (result funcref) local.get 0 table.get $t32)
)`;

let inst;
try {
  inst = await instantiate(wat1, {}, { memory64: true, reference_types: true, bulk_memory: true });
} catch (e) {
  print("COMPILE_ERR: " + e.message);
  quit(0);
}
const e = inst.exports;

// Basic valid copy: 64<-32
await T("copy_64_32(0,0,5)", () => e.copy_64_32(0n, 0, 5));
await T("get64(0)", () => e.get64(0n));
await T("get64(4)", () => e.get64(4n));

// dst=i64 with high bits: should trap (OOB)
await T("copy_64_32(0x100000000,0,1)/expect=TRAP", () => e.copy_64_32(0x100000000n, 0, 1));
await T("copy_64_32(0x100000005,0,1)/expect=TRAP", () => e.copy_64_32(0x100000005n, 0, 1));

// src=i64 with high bits (via copy_32_64): should trap
await T("copy_32_64(0,0x100000000,1)/expect=TRAP", () => e.copy_32_64(0, 0x100000000n, 1));

// n is i32 here (since one side is i32). Can't test i64 n.

// Now test table.init on table64 with elem segment
const wat2 = `
(module
  (table $t64 i64 10 funcref)
  (func $f (result i32) i32.const 42)
  (elem $e funcref (ref.func $f) (ref.func $f) (ref.func $f))
  (func (export "init") (param i64 i32 i32)
    local.get 0 local.get 1 local.get 2 table.init $t64 $e)
)`;
const inst2 = await instantiate(wat2, {}, { memory64: true, reference_types: true, bulk_memory: true });
await T("init(0x100000000,0,1)/expect=TRAP", () => inst2.exports.init(0x100000000n, 0, 1));
await T("init(0x100000005,0,1)/expect=TRAP", () => inst2.exports.init(0x100000005n, 0, 1));
await T("init(0,0,3)", () => inst2.exports.init(0n, 0, 3));
