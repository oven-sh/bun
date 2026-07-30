// BUG #4: table import linking doesn't check addressType
// WebAssemblyModuleRecord.cpp:435-465 checks initial/max/elem-type but NOT addressType.
// Spec requires addressType to match (limits matching includes idx type).

import { compile } from "../JSTests/wasm/wabt-wrapper.js";

// Module declares imported table as i64
const mod64 = await compile(`
  (module
    (import "e" "t" (table i64 10 funcref))
    (func $f (result i32) i32.const 42)
    (elem declare func $f)
    (func (export "size") (result i64) table.size 0)
    (func (export "get") (param i64) (result funcref) local.get 0 table.get 0)
    (func (export "set") (param i64) local.get 0 ref.func $f table.set 0)
    (func (export "grow") (param i64) (result i64) ref.null func local.get 0 table.grow 0)
  )`, { memory64: true, reference_types: true });

// Create an I32 table from JS
const t32 = new WebAssembly.Table({element: "funcref", initial: 10});

let linkThrew = false;
let inst;
try {
  inst = new WebAssembly.Instance(mod64, {e: {t: t32}});
} catch (e) {
  linkThrew = true;
  print("Link correctly threw: " + e.constructor.name + ": " + e.message);
}

if (!linkThrew) {
  print("FAIL: linking i32 Table to i64 import succeeded (should throw LinkError)");
  // Probe the type confusion
  const sz = inst.exports.size();
  print("  size() returned: " + sz + " (type: " + typeof sz + ")");
  print("  This is a spec violation: table addressType should be checked at link time");

  // Try to use the table with i64 indices
  try {
    inst.exports.set(0n);
    const v = inst.exports.get(0n);
    print("  get(0n) after set(0n): " + v);
  } catch (e) {
    print("  get/set with i64 index: " + e.message);
  }

  // Reverse: declare i32, pass i64
  const mod32 = await compile(`
    (module
      (import "e" "t" (table 10 funcref))
      (func (export "size") (result i32) table.size 0)
    )`, { reference_types: true });
  const t64 = new WebAssembly.Table({element: "funcref", initial: 10n, address: "i64"});
  let linkThrew2 = false;
  try {
    new WebAssembly.Instance(mod32, {e: {t: t64}});
  } catch (e) {
    linkThrew2 = true;
  }
  print("  reverse (i64 table -> i32 import) threw: " + linkThrew2);

  $vm.abort();
}
print("PASS");
