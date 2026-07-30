// BUG #2b: table64 elem segment offset via imported i64 global uses loadI32Global
// WebAssemblyModuleRecord.cpp:848 hardcodes loadI32Global() even for table64.
// This reads only the low 32 bits of the i64 global, truncating.

import { compile } from "../JSTests/wasm/wabt-wrapper.js";

// (import "e" "off" (global $off i64))
// (table i64 10 funcref)
// (elem (global.get $off) $f)
const wat = `
(module
  (import "e" "off" (global $off i64))
  (table i64 10 funcref)
  (func $f (result i32) i32.const 42)
  (func (export "get") (param i64) (result funcref) local.get 0 table.get 0)
  (elem (global.get $off) $f)
)`;

const mod = await compile(wat, { memory64: true, reference_types: true });

// Test 1: off = 4294967296n (2^32) - truncates to 0, should trap
let trapped = false;
let inst;
try {
  inst = new WebAssembly.Instance(mod, {e: {off: new WebAssembly.Global({value: "i64"}, 4294967296n)}});
} catch (e) {
  trapped = true;
  print("Instantiate with off=2^32: " + e.message);
}

if (!trapped) {
  print("FAIL: instantiate succeeded with elem offset global=2^32 (should trap OOB)");
  const v = inst.exports.get(0n);
  if (v !== null) print("  CONFIRMED: element written at truncated offset 0: " + v);
  $vm.abort();
}
print("PASS: elem offset via i64 global=2^32 correctly trapped");

// Test 2: off = 5n - should work
const inst2 = new WebAssembly.Instance(mod, {e: {off: new WebAssembly.Global({value: "i64"}, 5n)}});
const v = inst2.exports.get(5n);
print("get(5) with off=5: " + v);
