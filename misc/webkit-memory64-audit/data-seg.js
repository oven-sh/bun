// Test active data segments with i64 offset in memory64
import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

async function T(label, fn) {
  try {
    await fn();
    print(`${label}\tOK`);
  } catch (e) {
    const kind = e instanceof WebAssembly.RuntimeError ? "TRAP"
               : e instanceof WebAssembly.CompileError ? "COMPILE_ERR"
               : e instanceof WebAssembly.LinkError ? "LINK_ERR" : "ERR";
    print(`${label}\t${kind}\t${String(e.message || e).slice(0,120)}`);
  }
}

// memory is 1 page = 65536 bytes. Data is "ABCDE" (5 bytes).
// Valid iff offset + 5 <= 65536, i.e., offset <= 65531.
const tests = [
  ["0", true],
  ["65531", true],
  ["65532", false],
  ["65536", false],
  ["131072", false],
  ["4294967291", false],
  ["4294967296", false],
  ["18446744073709551611", false], // 2^64 - 5, wraps to 0 if truncated to u32? no
  ["18446744073709551615", false],
];

for (const [off, shouldOk] of tests) {
  const wat = `(module (memory i64 1) (data (i64.const ${off}) "ABCDE"))`;
  await T(`data-seg/off=${off}/expect=${shouldOk?"OK":"TRAP"}`, () => instantiate(wat, {}, { memory64: true }));
}

// Now: elem segment with i64 offset in table64
const etests = [
  ["0", true],
  ["9", true],
  ["10", false],
  ["4294967296", false],
  ["18446744073709551615", false],
];
for (const [off, shouldOk] of etests) {
  const wat = `(module (table i64 10 funcref) (func $f) (elem (i64.const ${off}) $f))`;
  await T(`elem-seg/off=${off}/expect=${shouldOk?"OK":"TRAP"}`, () => instantiate(wat, {}, { memory64: true, reference_types: true }));
}
