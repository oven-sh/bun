// BUG #3 (latent): OMG fixupPointerPlusOffset truncates uint64 offset to uint32
// WasmOMGIRGenerator.cpp:1183 takes uint32_t, callers at :2634/:2794 pass uint64_t.
// With JSC's 4GB memory cap, offset>=4GB always fails the bounds check, so not
// currently exploitable. But if that cap is ever raised, becomes OOB access.
//
// This test empirically verifies: with offset=0x100000000 (truncates to 0),
// does OMG correctly trap, or does it access addr+0 after the bounds check?

import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

const wat = `
(module
  (memory i64 2)  ;; 128KB
  (func (export "ld") (param i64) (result i32)
    local.get 0
    i32.load offset=0x100000000)  ;; 4GB offset, truncates to 0 in u32
  (func (export "st") (param i64 i32)
    local.get 0 local.get 1
    i32.store offset=0x100000000)
)`;

const inst = await instantiate(wat, {}, { memory64: true });
const { ld, st } = inst.exports;

// Warm up to force OMG tier-up
let fails = 0;
for (let i = 0; i < 200000; i++) {
  let trapped = false;
  try { ld(0n); } catch (e) { trapped = e instanceof WebAssembly.RuntimeError; }
  if (!trapped) {
    print(`FAIL iteration ${i}: ld(0) with offset=4GB did not trap!`);
    fails++;
    if (fails > 3) break;
  }
}

if (fails) {
  print(`\n${fails} failures - OMG may have skipped bounds check or used truncated offset`);
  $vm.abort();
}
print("PASS: 200k iterations, offset=4GB always trapped correctly (OMG tier-up included)");
