// BUG CANDIDATE 1: Multi-memory + memory64 address truncation in IPInt
// popMemoryIndex() uses m_cachedIsMemory64 (memory 0 only) to decide whether
// to zero-extend. When memory 0 is i32 and memory N (N>0) is i64, i64
// addresses for memory N get their high 32 bits cleared.

import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

async function test() {
  const wat = `
    (module
      (memory $m0 1)           ;; memory 0: i32, 1 page
      (memory $m1 i64 1)       ;; memory 1: i64, 1 page
      (func (export "write1") (param i64 i32)
        local.get 0
        local.get 1
        i32.store (memory 1))
      (func (export "read1") (param i64) (result i32)
        local.get 0
        i32.load (memory 1))
    )`;

  let inst;
  try {
    inst = await instantiate(wat, {}, { multi_memory: true, memory64: true });
  } catch (e) {
    print("instantiate failed: " + e);
    return;
  }

  const { write1, read1 } = inst.exports;

  // Write sentinel at offset 0 of memory 1
  write1(0n, 0xDEADBEEF | 0);

  // Read at 4GB - should trap (OOB), memory 1 is only 64KB
  let fails = 0;
  for (const [addr, desc] of [[0x1_0000_0000n, "4GB"], [0x1_0000_0004n, "4GB+4"], [0xFFFF_FFFF_0000_0000n, "~0<<32"]]) {
    let trapped = false;
    let result;
    try {
      result = read1(addr);
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) trapped = true;
      else throw e;
    }
    if (!trapped) {
      print(`FAIL: read1(${desc}) did not trap, returned 0x${(result>>>0).toString(16)}`);
      fails++;
    } else {
      print(`PASS: read1(${desc}) correctly trapped`);
    }
  }

  // Reverse: memory 0 is i64, memory 1 is i32
  const wat2 = `
    (module
      (memory $m0 i64 1)       ;; memory 0: i64, 1 page
      (memory $m1 1)           ;; memory 1: i32, 1 page
      (func (export "read1") (param i64) (result i32)
        local.get 0
        i32.wrap_i64             ;; now "i32" on stack but IPInt keeps i64 bits
        i32.load (memory 1))
    )`;
  let inst2;
  try {
    inst2 = await instantiate(wat2, {}, { multi_memory: true, memory64: true });
  } catch (e) {
    print("reverse instantiate failed: " + e);
    return fails;
  }
  const read1b = inst2.exports.read1;

  // i32.wrap_i64(0x1_0000_0000) = 0 (spec), so read at 0 should succeed
  // If IPInt doesn't wrap and doesn't zero-extend (because mem0 is i64),
  // the address would be 0x1_0000_0000 and would OOB-trap (wrong!)
  let trapped = false;
  try {
    read1b(0x1_0000_0000n);
  } catch (e) {
    if (e instanceof WebAssembly.RuntimeError) trapped = true;
    else throw e;
  }
  if (trapped) {
    print("FAIL (reverse): read1(wrap(4GB)) trapped, expected read at 0");
    fails++;
  } else {
    print("PASS (reverse): read1(wrap(4GB)) succeeded");
  }

  return fails;
}

await test().then(fails => {
  if (fails) { print(`\n${fails} FAILURES`); $vm.abort(); }
  else print("\nAll passed");
});
