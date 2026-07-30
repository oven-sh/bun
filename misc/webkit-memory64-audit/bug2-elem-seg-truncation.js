// BUG #2: table64 active element segment offset truncated to u32
// An elem segment at (i64.const 0x100000000) should fail to instantiate
// on a table of size 10, but the offset is truncated to 0.

import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

const wat = `
(module
  (table i64 10 funcref)
  (func $f (result i32) i32.const 42)
  (func (export "get") (param i64) (result funcref) local.get 0 table.get 0)
  (elem (i64.const 4294967296) $f)  ;; 0x1_0000_0000, should be OOB
)`;

let inst;
let failed = false;
try {
  inst = await instantiate(wat, {}, { memory64: true, reference_types: true });
} catch (e) {
  print("Instantiate correctly threw: " + e.message);
  failed = true;
}

if (!failed) {
  print("FAIL: instantiate succeeded (elem offset 4294967296 should be OOB on size-10 table)");
  // Check what ended up at index 0 (where truncated offset would land)
  const v = inst.exports.get(0n);
  print("  table[0] = " + v);
  if (v !== null) {
    print("  CONFIRMED: element was written at truncated offset 0");
  }
  $vm.abort();
}
print("PASS");
