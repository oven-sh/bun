;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  (memory (export "memory") 1 2)

  ;; No path needs a frame.
  (func $load (export "load") (param i32) (result i32)
    local.get 0 i32.load offset=8)

  (func $store (export "store") (param i32) (param i64) (result i64)
    local.get 0 local.get 1 i64.store
    local.get 1 i64.const 1 i64.add)

  ;; Only the unlikely arm needs a frame. The faults are before, in and after it.
  (func $sum (export "sum") (param $a i32) (param $b i32) (param $c i32) (param $calls i32) (result i32)
    (local $total i32)
    local.get $a i32.load local.set $total
    local.get $calls
    if
      local.get $total local.get $b call $twice local.get $b i32.load i32.add i32.add local.set $total
    end
    local.get $total local.get $c i32.load i32.add)

  (func $twice (export "twice") (param i32) (result i32)
    local.get 0 i32.const 2 i32.mul)

  ;; Many values, so that the arm with the frame saves registers.
  (func $many (export "many") (param $a i32) (param $b i32) (param $at i32) (param $calls i32) (result i32)
    (local $c i32) (local $d i32) (local $e i32) (local $f i32) (local $g i32) (local $h i32) (local $i i32) (local $j i32) (local $k i32) (local $l i32)
    local.get $a local.get $b i32.add local.set $c
    local.get $b local.get $c i32.mul local.set $d
    local.get $c local.get $d i32.xor local.set $e
    local.get $d local.get $e i32.sub local.set $f
    local.get $e local.get $f i32.add local.set $g
    local.get $f local.get $g i32.mul local.set $h
    local.get $g local.get $h i32.xor local.set $i
    local.get $h local.get $i i32.sub local.set $j
    local.get $i local.get $j i32.add local.set $k
    local.get $j local.get $k i32.xor local.set $l
    local.get $calls
    if
      local.get $l call $twice local.set $l
    end
    local.get $at i32.load
    local.get $c i32.add local.get $d i32.add local.get $e i32.add local.get $f i32.add local.get $g i32.add
    local.get $h i32.add local.get $i i32.add local.get $j i32.add local.get $k i32.add local.get $l i32.add)

  ;; A loop that faults on a late iteration.
  (func $fill (export "fill") (param $from i32) (param $count i32) (result i32)
    loop $again
      local.get $from local.get $count i32.store
      local.get $from i32.const 4096 i32.add local.set $from
      local.get $count i32.const 1 i32.sub local.tee $count br_if $again
    end
    local.get $from)

  ;; Callers with frames of their own, three deep.
  (func $outer (export "outer") (param $at i32) (param $x i32) (result i32)
    local.get $x local.get $at call $middle local.get $x i32.mul i32.add)
  (func $middle (param $at i32) (result i32)
    (local $before i32)
    i32.const 0 call $load local.set $before
    local.get $at call $load local.get $before i32.add)
)
