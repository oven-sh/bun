;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: exception-handling (try, catch, rethrow, delegate).
(module
  (import "env" "fail" (func $fail (param i32)))
  (tag $pair (export "pair") (param i32 f64))
  (tag $wide (param i64 f32))
  (tag $none)
  (func $throwPair (param i32 f64) (throw $pair (local.get 0) (local.get 1)))
  (func (export "catchPair") (param i32 f64) (result f64)
    (local $a i32) (local $b f64)
    try (result f64)
      local.get 0 local.get 1 call $throwPair
      f64.const -1
    catch $pair
      local.set $b local.set $a
      local.get $a f64.convert_i32_s local.get $b f64.add
    end)
  (func (export "catchWide") (param i64 f32) (result i64)
    (local $f f32)
    try (result i64)
      local.get 0 local.get 1 throw $wide
    catch $wide
      local.set $f
      local.get $f i64.trunc_f32_s i64.add
    end)
  (func (export "rethrows") (param i32) (result i32)
    try (result i32)
      try (result i32)
        throw $none
      catch $none
        local.get 0
        if rethrow 1 end
        i32.const 1
      end
    catch_all
      i32.const 2
    end)
  (func (export "delegates") (result i32)
    try $outer (result i32)
      try (result i32)
        throw $none
      delegate $outer
    catch $none
      i32.const 3
    end)
  (func (export "catchesJavaScript") (param i32) (result i32)
    try (result i32)
      local.get 0 call $fail
      i32.const 0
    catch_all
      i32.const 4
    end)
  (func (export "letsOut") (param i32 f64) local.get 0 local.get 1 call $throwPair)
  (func (export "keepsLocals") (param $n i32) (result i32)
    (local $i i32) (local $sum i32)
    loop $l
      try
        local.get $i i32.const 1 i32.add local.set $i
        local.get $i i32.const 3 i32.and i32.eqz if throw $none end
        local.get $sum local.get $i i32.add local.set $sum
      catch $none
        local.get $sum i32.const 1000 i32.add local.set $sum
      end
      local.get $i local.get $n i32.lt_s br_if $l
    end
    local.get $sum)
  (func (export "trapIsNotCaught") (param i32) (result i32)
    try (result i32)
      i32.const 1 local.get 0 i32.div_s
    catch_all
      i32.const -1
    end)
)
