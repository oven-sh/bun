// WasmGC array.new_data / array.init_data with memory64
import { instantiate, compile } from "../JSTests/wasm/wabt-wrapper.js";

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

// array.new_data: (type_idx, data_idx) [addr:iN, len:i32] -> ref
// For memory64, addr should be i64.
const wat = `
(module
  (memory i64 1)
  (type $arr (array i8))
  (data $d "HelloWorld")
  (func (export "newdata") (param i32 i32) (result i32)
    local.get 0  ;; offset into data segment (i32)
    local.get 1  ;; length (i32)
    array.new_data $arr $d
    array.len)
  (func (export "initdata") (param i32 i32 i32) (result i32)
    i32.const 0 i32.const 20 array.new $arr
    (local.set 2)  ;; wait, can't reassign param... let me restructure
    drop
    i32.const 0
  )
)`;

// First check if array.new_data even takes memory address or data segment offset
// Per spec: array.new_data $t $d : [i32, i32] -> [(ref $t)]
//   first i32 = offset into the DATA SEGMENT (not linear memory)
//   second i32 = size
// So array.new_data is NOT affected by memory64 (offset is into data segment, always i32)
// SKIP this category.

// But: array.init_data: [ref, i32 dst, i32 src_offset, i32 size]
//   src_offset is into the DATA SEGMENT (i32)
// Also not memory64-related.

// What about: array.new from constant expr? No.

print("array.new_data/init_data use data segment offsets (always i32), not memory64 related");
print("SKIP");
