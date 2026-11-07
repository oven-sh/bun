;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: multi-value, reference-types, simd.
(module
  (import "env" "i32" (func $i32 (param i32) (result i32)))
  (import "env" "i64" (func $i64 (param i64) (result i64)))
  (import "env" "f32" (func $f32 (param f32) (result f32)))
  (import "env" "f64" (func $f64 (param f64) (result f64)))
  (import "env" "ref" (func $ref (param externref) (result externref)))
  (import "env" "fn" (func $fn (param funcref) (result funcref)))
  (import "env" "none" (func $none))
  (import "env" "pair" (func $pair (result i32 f64)))
  (import "env" "many" (func $many (param i32 i64 f32 f64 i32 i64 f32 f64 i32 i64 f32 f64 i32 i64 f32 f64 i32 i32 f64 f64) (result f64)))
  (import "env" "vector" (func $vector (param v128)))
  (elem declare func $callI32)
  (func $callI32 (export "callI32") (param i32) (result i32) (call $i32 (local.get 0)))
  (func (export "callI64") (param i64) (result i64) (call $i64 (local.get 0)))
  (func (export "callF32") (param f32) (result f32) (call $f32 (local.get 0)))
  (func (export "callF64") (param f64) (result f64) (call $f64 (local.get 0)))
  (func (export "callRef") (param externref) (result externref) (call $ref (local.get 0)))
  (func (export "callFn") (result i32) (ref.is_null (call $fn (ref.func $callI32))))
  (func (export "callNone") (call $none))
  (func (export "callPair") (result f64)
    (local $second f64)
    call $pair
    local.set $second
    f64.convert_i32_s
    local.get $second
    f64.add)
  (func (export "callMany") (param i32) (result f64)
    (call $many (local.get 0) (i64.const 2) (f32.const 3.5) (f64.const 4.25) (i32.const 5) (i64.const 6) (f32.const 7.5) (f64.const 8.25)
      (i32.const 9) (i64.const 10) (f32.const 11.5) (f64.const 12.25) (i32.const 13) (i64.const 14) (f32.const 15.5) (f64.const 16.25) (i32.const 17) (i32.const 18) (f64.const 19.5) (f64.const 20.5)))
  (func (export "callVector") (call $vector (v128.const i32x4 1 2 3 4)))
  (func (export "sumOfCalls") (param $n i32) (result i32)
    (local $sum i32)
    (loop $l
      (local.set $sum (i32.add (local.get $sum) (call $i32 (local.get $n))))
      (br_if $l (local.tee $n (i32.sub (local.get $n) (i32.const 1)))))
    (local.get $sum))
)
