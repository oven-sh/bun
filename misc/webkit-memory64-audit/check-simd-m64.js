// Check: does memory64 + SIMD v128.load validate?
import { compile } from "../JSTests/wasm/wabt-wrapper.js";

async function tryCompile(wat, label) {
  try {
    await compile(wat, { memory64: true, simd: true, threads: true });
    print(`OK   ${label}`);
    return true;
  } catch (e) {
    print(`FAIL ${label}: ${String(e).slice(0, 120)}`);
    return false;
  }
}

await tryCompile(`(module (memory i64 1)
  (func (param i64) (result v128) local.get 0 v128.load))`, "v128.load");
await tryCompile(`(module (memory i64 1)
  (func (param i64 v128) local.get 0 local.get 1 v128.store))`, "v128.store");
await tryCompile(`(module (memory i64 1)
  (func (param i64) (result v128) local.get 0 v128.load8x8_s))`, "v128.load8x8_s");
await tryCompile(`(module (memory i64 1)
  (func (param i64) (result v128) local.get 0 v128.load8_splat))`, "v128.load8_splat");
await tryCompile(`(module (memory i64 1)
  (func (param i64 v128) (result v128) local.get 0 local.get 1 v128.load8_lane 0))`, "v128.load8_lane");
await tryCompile(`(module (memory i64 1)
  (func (param i64) (result v128) local.get 0 v128.load32_zero))`, "v128.load32_zero");

await tryCompile(`(module (memory i64 1)
  (func (param i64) (result i32) local.get 0 i32.atomic.load))`, "i32.atomic.load");
await tryCompile(`(module (memory i64 1)
  (func (param i64 i32) (result i32) local.get 0 local.get 1 i32.atomic.rmw.add))`, "i32.atomic.rmw.add");
await tryCompile(`(module (memory i64 1)
  (func (param i64 i32 i32) (result i32) local.get 0 local.get 1 local.get 2 i32.atomic.rmw.cmpxchg))`, "i32.atomic.rmw.cmpxchg");
