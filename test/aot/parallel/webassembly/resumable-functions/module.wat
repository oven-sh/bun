;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  (global $sp (mut i32) (i32.const 4096))
  (memory (export "memory") 1)
  (table (export "table") 4 funcref)
  (elem (i32.const 0) $constants $dynamic $usesState $leaves)

  ;; Functions that switch on their only parameter first, as a compiler of functions that can be left and resumed makes them.
  (func $constants (export "constants") (param $state i32) (result i32)
    (local $x i32)
    loop $dispatch
      block $default block $3 block $2 block $1 block $0
      local.get $state br_table $0 $1 $2 $3 $default
      end
      global.get $sp i32.const 1 i32.add global.set $sp
      i32.const 0 return
      end
      i32.const 1 return
      end
      i32.const -1 return
      end
      local.get $x i32.const 1 i32.add local.tee $x i32.const 5 i32.lt_s
      if
        i32.const 3 local.set $state br $dispatch
      end
      i32.const 0 local.set $state br $dispatch
      end
    end
    i32.const 77)
  (func $dynamic (export "dynamic") (param $state i32) (result i32)
    (local $x i32)
    loop $dispatch
      block $default block $2 block $1 block $0
      local.get $state br_table $0 $1 $2 $default
      end
      global.get $sp i32.const 4096 i32.sub return
      end
      local.get $x i32.const 3 i32.add local.set $x i32.const 2 local.set $state br $dispatch
      end
      local.get $x i32.const 3 i32.sub return
      end
    end
    global.get $sp i32.const 4097 i32.sub)
  (func $usesState (export "usesState") (param $state i32) (result i32)
    (local $x i32)
    loop $dispatch
      block $default block $2 block $1 block $0
      local.get $state br_table $0 $1 $2 $default
      end
      local.get $x local.get $state i32.add i32.const 7 i32.add local.set $x
      global.get $sp local.get $x i32.add i32.const 4096 i32.sub local.set $x
      local.get $x i32.const 1 i32.and
      if
        i32.const 1 local.set $state br $dispatch
      end
      local.get $state local.get $x i32.add return
      end
      local.get $state local.get $x i32.mul return
      end
      local.get $state return
      end
    end
    local.get $state i32.const 1000 i32.add)
  (func $leaves (export "leaves") (param $state i32) (result i32)
    (local $a i64) (local $b i64) (local $c i64)
    block $left
    loop $dispatch
      block $default block $2 block $1 block $0
      local.get $state br_table $0 $1 $2 $default
      end
      global.get $sp i32.const 16 i32.sub global.set $sp
      global.get $sp i64.load offset=16 local.set $a
      global.get $sp i64.load offset=24 local.set $b
      local.get $a local.get $b i64.mul local.set $c
      i32.const 0 call $constants br_if $left
      global.get $sp local.get $a local.get $c i64.add i64.store offset=32
      end
      local.get $b i64.const 3 i64.add local.set $b
      i32.const 1 call $constants br_if $left
      i32.const 2 local.set $state br $dispatch
      end
      global.get $sp local.get $b local.get $c i64.xor i64.store offset=40
      global.get $sp i32.const 16 i32.add global.set $sp
      i32.const 0 return
      end
    end
    end
    global.get $sp local.get $b local.get $a i64.add i64.store offset=48
    global.get $sp i32.const 16 i32.add global.set $sp
    i32.const 1)
  (func $countsDown (export "countsDown") (param $state i32) (result i32)
    loop $dispatch
      block $default block $2 block $1 block $0
      local.get $state br_table $0 $1 $2 $default
      end
      global.get $sp i32.load offset=64 i32.eqz
      if
        i32.const 0 return
      end
      global.get $sp global.get $sp i32.load offset=64 i32.const 1 i32.sub i32.store offset=64
      i32.const 0 call $countsDown
      if
        i32.const 1 return
      end
      global.get $sp i32.load offset=64 i32.const 100 i32.eq return
      end
      i32.const 0 local.set $state br $dispatch
      end
      i32.const 5 return
      end
    end
    i32.const 1)

  (func (export "all") (param $v i32) (result i32)
    (local $hash i32) (local $w i32)
    ;; The result branched on.
    i32.const 0 call $constants if i32.const 1 local.set $hash end
    i32.const 1 call $constants if local.get $hash i32.const 2 i32.add local.set $hash end
    i32.const 2 call $constants if local.get $hash i32.const 4 i32.add local.set $hash end
    local.get $v call $constants if local.get $hash i32.const 8 i32.add local.set $hash end
    i32.const 0 call $constants i32.eqz if local.get $hash i32.const 16 i32.add local.set $hash end
    i32.const 0 call $dynamic if local.get $hash i32.const 32 i32.add local.set $hash end
    local.get $v call $dynamic i32.eqz if local.get $hash i32.const 64 i32.add local.set $hash end
    i32.const 0 call $usesState if local.get $hash i32.const 128 i32.add local.set $hash end
    i32.const 0 call $leaves if local.get $hash i32.const 256 i32.add local.set $hash end
    local.get $v call $leaves if local.get $hash i32.const 512 i32.add local.set $hash end
    global.get $sp local.get $v i32.const 127 i32.and i32.store offset=64
    i32.const 0 call $countsDown if local.get $hash i32.const 1024 i32.add local.set $hash end
    ;; The result as a value.
    i32.const 0 call $constants i32.const 3 i32.mul local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    i32.const 1 call $constants i32.const 3 i32.mul local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    i32.const 2 call $constants local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    i32.const 3 call $constants local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    i32.const 9 call $constants local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    local.get $v call $constants local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    i32.const 0 call $dynamic local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    i32.const 1 call $dynamic local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    i32.const 0 call $usesState local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    i32.const 1 call $usesState local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    local.get $v call $usesState local.tee $w local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    ;; Both.
    i32.const 0 call $usesState local.tee $w
    if
      local.get $hash local.get $w i32.add local.set $hash
    end
    i32.const 0 call $dynamic local.tee $w i32.const 1 i32.gt_s
    if
      local.get $hash local.get $w i32.sub local.set $hash
    end
    ;; Through the table.
    i32.const 0 i32.const 0 call_indirect (param i32) (result i32) if local.get $hash i32.const 5 i32.add local.set $hash end
    i32.const 0 local.get $v i32.const 3 i32.and call_indirect (param i32) (result i32) local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    i32.const 1 local.get $v i32.const 3 i32.and call_indirect (param i32) (result i32) local.get $hash i32.const 31 i32.mul i32.add local.set $hash
    local.get $hash)
  (func (export "sp") (result i32) global.get $sp)
)
