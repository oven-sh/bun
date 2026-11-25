;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  (import "env" "hook" (func $hook (param i32) (result i32)))
  (global $sp (mut i32) (i32.const 60000))
  (global $other (mut i32) (i32.const 5))
  (global $wide (mut i64) (i64.const 7))
  (memory (export "memory") 1)
  (table (export "table") 8 funcref)
  (elem (i32.const 0) $push $pop $leaf $hook $unbalanced $deep)

  (func (export "get") (result i32) global.get $sp)
  (func (export "set") (param $value i32) local.get $value global.set $sp)

  ;; Moves the stack pointer down and leaves it there.
  (func $push (export "push") (param $n i32) (result i32)
    global.get $sp local.get $n i32.sub global.set $sp
    global.get $sp)
  (func $pop (export "pop") (param $n i32) (result i32)
    global.get $sp local.get $n i32.add global.set $sp
    global.get $sp)

  ;; Does not use the global. Its loop has many values.
  (func $leaf (export "leaf") (param $n i32) (result i32)
    (local $a i32) (local $b i32) (local $c i32) (local $d i32) (local $e i32) (local $f i32) (local $g i32) (local $h i32) (local $i i32) (local $j i32)
    loop $again
      local.get $a local.get $n i32.add local.set $b
      local.get $b local.get $c i32.xor local.set $d
      local.get $d local.get $e i32.add local.set $f
      local.get $f local.get $g i32.sub local.set $h
      local.get $h local.get $i i32.xor local.set $j
      local.get $j local.set $a local.get $h local.set $c local.get $f local.set $e local.get $d local.set $g local.get $b local.set $i
      local.get $n i32.const 1 i32.sub local.tee $n br_if $again
    end
    local.get $a local.get $c i32.add local.get $e i32.add local.get $g i32.add local.get $i i32.add)

  ;; Does not use the global, but its callees do.
  (func $passesOn (export "passesOn") (param $n i32) (result i32)
    local.get $n call $push drop
    local.get $n call $leaf
    i32.const 4 call $pop i32.add)

  ;; A frame in linear memory, as compilers make it, around a call.
  (func $frame (export "frame") (param $n i32) (result i32)
    (local $base i32)
    global.get $sp i32.const 16 i32.sub local.tee $base global.set $sp
    local.get $base local.get $n i32.store offset=4
    local.get $n
    if
      local.get $base local.get $n i32.const 1 i32.sub call $frame i32.store offset=8
    end
    local.get $base i32.load offset=4 local.get $base i32.load offset=8 i32.add local.get $base i32.add
    local.get $base i32.const 16 i32.add global.set $sp)

  ;; Several writes in a row, on both arms of a branch, and in a loop.
  (func $writes (export "writes") (param $n i32) (result i32)
    loop $again
      local.get $n i32.const 1 i32.and
      if
        global.get $sp i32.const 8 i32.sub global.set $sp
        global.get $sp i32.const 8 i32.sub global.set $sp
      else
        i32.const 4 call $pop drop
        global.get $sp i32.const 1 i32.add global.set $sp
      end
      local.get $n i32.const 1 i32.sub local.tee $n br_if $again
    end
    global.get $sp)

  ;; Through JavaScript, which may call back and move the global.
  (func $throughImport (export "throughImport") (param $n i32) (result i32)
    global.get $sp i32.const 32 i32.sub global.set $sp
    local.get $n call $hook
    global.get $sp i32.add
    global.get $sp i32.const 32 i32.add global.set $sp)

  ;; Through the table: a function of this module, an import, a function of another instance.
  (func $throughTable (export "throughTable") (param $index i32) (param $n i32) (result i32)
    global.get $sp i32.const 64 i32.sub global.set $sp
    local.get $n local.get $index call_indirect (param i32) (result i32)
    global.get $sp i32.add
    i32.const 64 call $pop drop)

  (func $unbalanced (export "unbalanced") (param $n i32) (result i32)
    global.get $sp local.get $n i32.add global.set $sp
    local.get $n)

  (func $deep (export "deep") (param $n i32) (result i32)
    local.get $n i32.eqz
    if
      global.get $sp return
    end
    global.get $sp i32.const 1 i32.sub global.set $sp
    local.get $n i32.const 1 i32.sub call $deep
    global.get $sp i32.const 1 i32.add global.set $sp
    global.get $sp i32.add)

  ;; The global is written before the fault.
  (func $faults (export "faults") (param $at i32) (result i32)
    global.get $sp i32.const 3 i32.sub global.set $sp
    local.get $at i32.load
    global.get $sp i32.const 3 i32.add global.set $sp)
  (func $callsFaults (export "callsFaults") (param $at i32) (result i32)
    global.get $sp i32.const 5 i32.sub global.set $sp
    local.get $at call $faults
    global.get $sp i32.const 5 i32.add global.set $sp)

  ;; No result, two results, results and arguments of every kind, more arguments than registers.
  (func $nothing (param $n i32) global.get $sp local.get $n i32.add global.set $sp)
  (func $two (param $n i32) (result i32 i64)
    global.get $sp i32.const 2 i32.sub global.set $sp
    local.get $n i32.const 1 i32.add local.get $n i64.extend_i32_u i64.const 10 i64.mul)
  (func $mixed (param $a i32) (param $b i64) (param $c f32) (param $d f64) (param $e i32) (param $f i32) (param $g i32) (param $h i32) (param $i i64) (param $j i32) (result f64)
    global.get $sp i32.const 7 i32.sub global.set $sp
    local.get $a local.get $e i32.add local.get $f i32.add local.get $g i32.add local.get $h i32.add local.get $j i32.add f64.convert_i32_s
    local.get $b f64.convert_i64_s f64.add local.get $c f64.promote_f32 f64.add local.get $d f64.add local.get $i f64.convert_i64_s f64.add)
  (func (export "everyKind") (param $n i32) (result f64)
    (local $x i64)
    local.get $n call $nothing
    local.get $n call $two local.set $x
    f64.convert_i32_s local.get $x f64.convert_i64_s f64.add
    local.get $n i64.const 11 f32.const 1.5 f64.const 2.25 i32.const 3 i32.const 4 i32.const 5 i32.const 6 i64.const 12 i32.const 8 call $mixed f64.add
    global.get $sp f64.convert_i32_s f64.add
    global.get $other f64.convert_i32_s f64.add
    global.get $wide f64.convert_i64_s f64.add
    global.get $other i32.const 1 i32.add global.set $other
    global.get $wide i64.const 1 i64.add global.set $wide)
)
