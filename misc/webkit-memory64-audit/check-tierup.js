// Check if memory64 functions actually tier up to BBQ/OMG
import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

const wat = `
  (module
    (memory i64 1)
    (func (export "hot") (param i64) (result i32)
      (local i32)
      (loop $l
        local.get 0
        i32.load
        local.set 1
        local.get 0
        i64.const 0
        i64.ne
        br_if $l)
      local.get 1))`;

const inst = await instantiate(wat, {}, { memory64: true });
const hot = inst.exports.hot;

// Warm up heavily
for (let i = 0; i < 1e6; i++) hot(0n);
print("done warming up");

// If we have dollarVM, check tier
if (typeof $vm !== 'undefined') {
  // Can't easily introspect wasm tier from JS. Check timing instead.
  const t0 = performance.now();
  for (let i = 0; i < 1e7; i++) hot(0n);
  const t1 = performance.now();
  print(`1e7 calls: ${(t1-t0).toFixed(1)}ms`);
}
