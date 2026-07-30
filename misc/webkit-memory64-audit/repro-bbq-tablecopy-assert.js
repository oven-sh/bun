// Minimal repro: debug BBQ assertion failure for mixed table64/table32 table.copy
// Source/JavaScriptCore/wasm/WasmBBQJIT.cpp line ~973:
//   ASSERT(dstOffset.type() == m_info.table(srcTableIndex).addressType().asWasmTypeKind());
//   ASSERT(srcOffset.type() == m_info.table(dstTableIndex).addressType().asWasmTypeKind());
// The table indexes are swapped — should be dstTableIndex/srcTableIndex respectively.
import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";
const wat = `
(module
  (table $t64 i64 4 funcref)
  (table $t32     4 funcref)
  (func (export "go")
    i64.const 0 i32.const 0 i32.const 0
    table.copy $t64 $t32))
`;
const inst = await instantiate(wat, {}, { memory64: true, reference_types: true, bulk_memory: true });
inst.exports.go();
print("ok");
