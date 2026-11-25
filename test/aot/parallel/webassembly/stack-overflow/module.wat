;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  ;; Calls itself without end. The addition after the call keeps it from being a tail call.
  (func $forever (export "forever") (param i32) (result i32)
    local.get 0 i32.const 1 i32.add call $forever i32.const 1 i32.add)

  ;; Two functions that call each other without end.
  (func $ping (export "ping") (param i32) (result i32)
    local.get 0 i32.const 1 i32.add call $pong i32.const 1 i32.add)
  (func $pong (param i32) (result i32)
    local.get 0 i32.const 2 i32.add call $ping i32.const 3 i32.mul)

  ;; Many values live across the call, so the frame is larger.
  (func $wide (export "wide") (param $n i64) (result i64)
    (local $a i64) (local $b i64) (local $c i64) (local $d i64) (local $e i64) (local $f i64) (local $g i64) (local $h i64)
    (local $i i64) (local $j i64) (local $k i64) (local $l i64) (local $m i64) (local $o i64) (local $p i64) (local $q i64)
    local.get $n i64.const 3 i64.mul local.set $a
    local.get $a i64.const 5 i64.add local.set $b
    local.get $b i64.const 7 i64.mul local.set $c
    local.get $c i64.const 11 i64.xor local.set $d
    local.get $d i64.const 13 i64.add local.set $e
    local.get $e i64.const 17 i64.mul local.set $f
    local.get $f i64.const 19 i64.xor local.set $g
    local.get $g i64.const 23 i64.add local.set $h
    local.get $h i64.const 29 i64.mul local.set $i
    local.get $i i64.const 31 i64.xor local.set $j
    local.get $j i64.const 37 i64.add local.set $k
    local.get $k i64.const 41 i64.mul local.set $l
    local.get $l i64.const 43 i64.xor local.set $m
    local.get $m i64.const 47 i64.add local.set $o
    local.get $o i64.const 53 i64.mul local.set $p
    local.get $p i64.const 59 i64.xor local.set $q
    local.get $q call $wide
    local.get $a i64.add local.get $b i64.add local.get $c i64.add local.get $d i64.add local.get $e i64.add local.get $f i64.add local.get $g i64.add local.get $h i64.add
    local.get $i i64.add local.get $j i64.add local.get $k i64.add local.get $l i64.add local.get $m i64.add local.get $o i64.add local.get $p i64.add local.get $q i64.add)

  ;; Ends: the stack is deep but not too deep.
  (func $countDown (export "countDown") (param $n i32) (result i32)
    local.get $n i32.eqz
    if
      i32.const 0 return
    end
    local.get $n i32.const 1 i32.sub call $countDown i32.const 1 i32.add)
)
