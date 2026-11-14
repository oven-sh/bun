;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  (global $sp (mut i32) (i32.const 1000))
  (memory (export "memory") 1)

  ;; Each of the first functions begins with a test of its first parameter. `all` calls it with the constant zero, with another constant and with a variable.
  (func $isZero (param $n i32) (result i32)
    local.get $n i32.eqz
    if
      i32.const 10 return
    end
    local.get $n i32.const 20 i32.add)
  (func $isNotZero (param $n i32) (result i32)
    local.get $n
    if
      local.get $n i32.const 30 i32.add return
    end
    local.get $n i32.const 40 i32.add)
  (func $usesItLater (param $n i32) (param $m i32) (result i32)
    local.get $n
    if
      local.get $m i32.const 3 i32.mul local.set $m
    end
    local.get $n local.get $m i32.add local.get $n i32.const 7 i32.xor i32.add)
  (func $countsDown (param $n i32) (result i32)
    (local $sum i32)
    block $done
    loop $again
      local.get $n i32.eqz br_if $done
      local.get $sum local.get $n i32.add local.set $sum
      local.get $n i32.const 1 i32.sub local.set $n
      br $again
    end
    end
    local.get $sum local.get $n i32.add)
  (func $writes (param $n i32) (result i32)
    local.get $n
    if
      global.get $sp local.get $n i32.sub global.set $sp
    else
      global.get $sp i32.const 1 i32.add global.set $sp
    end
    global.get $sp)
  (func $machine (param $state i32) (result i32)
    (local $x i32)
    loop $dispatch
      block $default block $2 block $1 block $0
      local.get $state br_table $0 $1 $2 $default
      end local.get $x i32.const 1 i32.add local.set $x i32.const 2 local.set $state br $dispatch
      end local.get $x i32.const 10 i32.add local.set $x i32.const 3 local.set $state br $dispatch
      end local.get $x i32.const 100 i32.add local.set $x i32.const 1 local.set $state br $dispatch
      end
    end
    local.get $x)
  (func $wide (param $n i64) (result i64)
    local.get $n i64.eqz
    if
      i64.const 50 return
    end
    local.get $n i64.const 1 i64.add)
  (func $second (param $n i32) (param $m i32) (result i32)
    local.get $m i32.eqz
    if
      local.get $n i32.const 60 i32.add return
    end
    local.get $n local.get $m i32.mul)
  (func $floatFirst (param $f f64) (param $n i32) (result i32)
    local.get $n i32.eqz
    if
      local.get $f i32.trunc_f64_s return
    end
    local.get $n)
  (func $calls (param $n i32) (result i32)
    local.get $n i32.eqz
    if
      i32.const 0 call $isZero return
    end
    local.get $n i32.const 1 i32.sub call $calls local.get $n i32.add)

  (func (export "all") (param $v i32) (result i32)
    (local $hash i32)
    i32.const 0 call $isZero i32.const 5 call $isZero i32.const 31 i32.mul i32.add local.get $v call $isZero i32.const 17 i32.mul i32.add local.set $hash
    i32.const 0 call $isNotZero i32.const 5 call $isNotZero i32.const 31 i32.mul i32.add local.get $v call $isNotZero i32.const 17 i32.mul i32.add local.get $hash i32.const 3 i32.mul i32.add local.set $hash
    i32.const 0 local.get $v call $usesItLater i32.const 5 local.get $v call $usesItLater i32.const 31 i32.mul i32.add local.get $v i32.const 2 call $usesItLater i32.const 17 i32.mul i32.add local.get $hash i32.const 3 i32.mul i32.add local.set $hash
    i32.const 0 call $countsDown i32.const 5 call $countsDown i32.const 31 i32.mul i32.add local.get $v call $countsDown i32.const 17 i32.mul i32.add local.get $hash i32.const 3 i32.mul i32.add local.set $hash
    i32.const 0 call $writes i32.const 5 call $writes i32.const 31 i32.mul i32.add local.get $v call $writes i32.const 17 i32.mul i32.add local.get $hash i32.const 3 i32.mul i32.add local.set $hash
    i32.const 0 call $machine i32.const 1 call $machine i32.const 31 i32.mul i32.add local.get $v call $machine i32.const 17 i32.mul i32.add local.get $hash i32.const 3 i32.mul i32.add local.set $hash
    i64.const 0 call $wide i64.const 5 call $wide i64.const 31 i64.mul i64.add i32.wrap_i64 local.get $hash i32.const 3 i32.mul i32.add local.set $hash
    i32.const 0 local.get $v call $second i32.const 0 i32.const 0 call $second i32.const 31 i32.mul i32.add local.get $v i32.const 0 call $second i32.const 17 i32.mul i32.add local.get $hash i32.const 3 i32.mul i32.add local.set $hash
    f64.const 7.5 i32.const 0 call $floatFirst f64.const 7.5 i32.const 9 call $floatFirst i32.const 31 i32.mul i32.add local.get $hash i32.const 3 i32.mul i32.add local.set $hash
    i32.const 0 call $calls local.get $v i32.const 63 i32.and call $calls i32.const 31 i32.mul i32.add local.get $hash i32.const 3 i32.mul i32.add)
  (func (export "sp") (result i32) global.get $sp)
)
