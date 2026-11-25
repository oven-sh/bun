;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  ;; Ten targets and a default: a table of jumps.
  (func (export "dense") (param i32) (result i32)
    block $default
    block $9 block $8 block $7 block $6 block $5 block $4 block $3 block $2 block $1 block $0
    local.get 0
    br_table $0 $1 $2 $3 $4 $5 $6 $7 $8 $9 $default
    end i32.const 100 return
    end i32.const 101 return
    end i32.const 102 return
    end i32.const 103 return
    end i32.const 104 return
    end i32.const 105 return
    end i32.const 106 return
    end i32.const 107 return
    end i32.const 108 return
    end i32.const 109 return
    end i32.const -1)
  ;; Three targets: compares.
  (func (export "sparse") (param i32) (result i32)
    block $default block $1 block $0
    local.get 0
    br_table $0 $1 $0 $default
    end i32.const 10 return
    end i32.const 11 return
    end i32.const 12)
  ;; Each target takes a value.
  (func (export "withValue") (param i32 i32) (result i32)
    block $h (result i32) block $g (result i32) block $f (result i32) block $e (result i32)
    block $d (result i32) block $c (result i32) block $b (result i32) block $a (result i32)
    local.get 1
    local.get 0
    br_table $a $b $c $d $e $f $g $h
    end i32.const 1 i32.add
    end i32.const 2 i32.mul
    end i32.const 3 i32.add
    end i32.const 4 i32.mul
    end i32.const 5 i32.add
    end i32.const 6 i32.mul
    end i32.const 7 i32.add
    end)
  ;; A table in a loop, with locals that live across it.
  (func (export "machine") (param $n i32) (result i32)
    (local $state i32) (local $acc i32)
    loop $again
      block $out
      block $7 block $6 block $5 block $4 block $3 block $2 block $1 block $0
      local.get $state
      br_table $0 $1 $2 $3 $4 $5 $6 $7 $out
      end local.get $acc i32.const 1 i32.add local.set $acc br $out
      end local.get $acc i32.const 3 i32.mul local.set $acc br $out
      end local.get $acc i32.const 5 i32.xor local.set $acc br $out
      end local.get $acc i32.const 7 i32.sub local.set $acc br $out
      end local.get $acc i32.const 1 i32.shl local.set $acc br $out
      end local.get $acc i32.const 11 i32.add local.set $acc br $out
      end local.get $acc i32.const 13 i32.rotl local.set $acc br $out
      end local.get $acc local.get $n i32.add local.set $acc
      end
      local.get $state i32.const 3 i32.add i32.const 7 i32.and local.set $state
      local.get $n i32.const 1 i32.sub local.tee $n
      br_if $again
    end
    local.get $acc)
)
