;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  (global $sp (mut i32) (i32.const 1000))
  (memory (export "memory") 1 40)

  (func (export "wideUnproven") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0)
  (func (export "wideSmaller") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load offset=24 local.set $sum
    local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "wideEqual") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load8_u offset=8 local.set $sum
    local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load8_u offset=0 local.get $sum i64.add)
  (func (export "wideAtEnd") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load8_u offset=7 local.set $sum
    local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load8_u offset=0 local.get $sum i64.add)
  (func (export "wideLarger") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load offset=8 local.set $sum
    local.get $p i64.const 24 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "wideStore") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 local.get $q i64.store offset=32
    local.get $p i64.const 16 i64.add i32.wrap_i64 local.get $q i64.const 1 i64.add i64.store offset=0
    local.get $p i64.const 16 i64.add i32.wrap_i64 i64.load offset=16 local.get $p i32.wrap_i64 i64.load offset=16 i64.add)
  (func (export "wideStoreUnproven") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i64.const 16 i64.add i32.wrap_i64 local.get $q i64.store offset=0
    local.get $p i32.wrap_i64 i64.load offset=16)
  (func (export "wideSetBetween") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load offset=64 local.set $sum
    local.get $q local.set $p
    local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "wideAddressFromBefore") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i64.const 8 i64.add i32.wrap_i64
    local.get $q local.set $p
    local.get $p i32.wrap_i64 i64.load offset=64 local.set $sum
    i64.load offset=0 local.get $sum i64.add)
  (func (export "wideOneArm") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $q i32.wrap_i64
    if
      local.get $p i32.wrap_i64 i64.load offset=64 local.set $sum
    end
    local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "wideOtherArm") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $q i32.wrap_i64
    if
      local.get $p i32.wrap_i64 i64.load offset=64 local.set $sum
    else
      local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.set $sum
    end
    local.get $sum)
  (func (export "wideInArm") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load offset=64 local.set $sum
    local.get $q i32.wrap_i64
    if
      local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.set $sum
    else
      local.get $p i64.const 16 i64.add i32.wrap_i64 i64.load offset=8 local.set $sum
    end
    local.get $p i64.const 32 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "wideLeavesBlock") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    block $b
      local.get $q i32.wrap_i64 br_if $b
      local.get $p i32.wrap_i64 i64.load offset=64 local.set $sum
    end
    local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "wideLoop") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    loop $l
      local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add local.set $sum
      local.get $p i32.wrap_i64 i64.load offset=64 local.get $sum i64.add local.set $sum
      local.get $q local.set $p
      local.get $i i32.const 1 i32.add local.tee $i i32.const 2 i32.lt_s br_if $l
    end
    local.get $sum)
  (func (export "wideLoopProvenBefore") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load offset=64 local.set $sum
    loop $l
      local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add local.set $sum
      local.get $q local.set $p
      local.get $i i32.const 1 i32.add local.tee $i i32.const 2 i32.lt_s br_if $l
    end
    local.get $sum)
  (func (export "wideBehindLoop") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load offset=64 local.set $sum
    loop $l
      local.get $sum i64.const 3 i64.mul local.set $sum
      local.get $i i32.const 1 i32.add local.tee $i i32.const 4 i32.lt_s br_if $l
    end
    local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "wideBehindLoopThatSets") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load offset=64 local.set $sum
    loop $l
      local.get $q local.set $p
      local.get $i i32.const 1 i32.add local.tee $i i32.const 4 i32.lt_s br_if $l
    end
    local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "widePartOfWord") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load8_u offset=4 local.set $sum
    local.get $p i32.wrap_i64 i64.load offset=0 i32.wrap_i64 i64.extend_i32_u local.get $sum i64.add)
  (func (export "wideWholeWord") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load8_u offset=7 local.set $sum
    local.get $p i32.wrap_i64 i64.load offset=0 i32.wrap_i64 i64.extend_i32_u local.get $sum i64.add)
  (func (export "widePointerInMemory") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load offset=16 local.set $sum
    local.get $p i32.wrap_i64 i64.load offset=8 i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "wideLargeOffset") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load offset=0x7ffffff0 local.set $sum
    local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0x7ffffff0 local.get $sum i64.add)
  (func (export "wideGrow") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32)
    local.get $p i32.wrap_i64 i64.load offset=64 local.set $sum
    i32.const 1 memory.grow drop
    local.get $p i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add memory.size i64.extend_i32_u i64.const 0 i64.mul i64.add)
  (func (export "narrowUnproven") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0)
  (func (export "narrowSmaller") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load offset=24 local.set $sum
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "narrowEqual") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load8_u offset=8 local.set $sum
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load8_u offset=0 local.get $sum i64.add)
  (func (export "narrowAtEnd") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load8_u offset=7 local.set $sum
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load8_u offset=0 local.get $sum i64.add)
  (func (export "narrowLarger") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load offset=8 local.set $sum
    local.get $n i64.extend_i32_u i64.const 24 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "narrowStore") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n local.get $q i64.store offset=32
    local.get $n i64.extend_i32_u i64.const 16 i64.add i32.wrap_i64 local.get $q i64.const 1 i64.add i64.store offset=0
    local.get $n i64.extend_i32_u i64.const 16 i64.add i32.wrap_i64 i64.load offset=16 local.get $n i64.load offset=16 i64.add)
  (func (export "narrowStoreUnproven") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.extend_i32_u i64.const 16 i64.add i32.wrap_i64 local.get $q i64.store offset=0
    local.get $n i64.load offset=16)
  (func (export "narrowSetBetween") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load offset=64 local.set $sum
    local.get $q i32.wrap_i64 local.set $n
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "narrowAddressFromBefore") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64
    local.get $q i32.wrap_i64 local.set $n
    local.get $n i64.load offset=64 local.set $sum
    i64.load offset=0 local.get $sum i64.add)
  (func (export "narrowOneArm") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $q i32.wrap_i64
    if
      local.get $n i64.load offset=64 local.set $sum
    end
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "narrowOtherArm") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $q i32.wrap_i64
    if
      local.get $n i64.load offset=64 local.set $sum
    else
      local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.set $sum
    end
    local.get $sum)
  (func (export "narrowInArm") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load offset=64 local.set $sum
    local.get $q i32.wrap_i64
    if
      local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.set $sum
    else
      local.get $n i64.extend_i32_u i64.const 16 i64.add i32.wrap_i64 i64.load offset=8 local.set $sum
    end
    local.get $n i64.extend_i32_u i64.const 32 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "narrowLeavesBlock") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    block $b
      local.get $q i32.wrap_i64 br_if $b
      local.get $n i64.load offset=64 local.set $sum
    end
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "narrowLoop") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    loop $l
      local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add local.set $sum
      local.get $n i64.load offset=64 local.get $sum i64.add local.set $sum
      local.get $q i32.wrap_i64 local.set $n
      local.get $i i32.const 1 i32.add local.tee $i i32.const 2 i32.lt_s br_if $l
    end
    local.get $sum)
  (func (export "narrowLoopProvenBefore") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load offset=64 local.set $sum
    loop $l
      local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add local.set $sum
      local.get $q i32.wrap_i64 local.set $n
      local.get $i i32.const 1 i32.add local.tee $i i32.const 2 i32.lt_s br_if $l
    end
    local.get $sum)
  (func (export "narrowBehindLoop") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load offset=64 local.set $sum
    loop $l
      local.get $sum i64.const 3 i64.mul local.set $sum
      local.get $i i32.const 1 i32.add local.tee $i i32.const 4 i32.lt_s br_if $l
    end
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "narrowBehindLoopThatSets") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load offset=64 local.set $sum
    loop $l
      local.get $q i32.wrap_i64 local.set $n
      local.get $i i32.const 1 i32.add local.tee $i i32.const 4 i32.lt_s br_if $l
    end
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "narrowPartOfWord") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load8_u offset=4 local.set $sum
    local.get $n i64.load offset=0 i32.wrap_i64 i64.extend_i32_u local.get $sum i64.add)
  (func (export "narrowWholeWord") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load8_u offset=7 local.set $sum
    local.get $n i64.load offset=0 i32.wrap_i64 i64.extend_i32_u local.get $sum i64.add)
  (func (export "narrowPointerInMemory") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load offset=16 local.set $sum
    local.get $n i64.load offset=8 i32.wrap_i64 i64.load offset=0 local.get $sum i64.add)
  (func (export "narrowLargeOffset") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load offset=0x7ffffff0 local.set $sum
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0x7ffffff0 local.get $sum i64.add)
  (func (export "narrowGrow") (param $p i64) (param $q i64) (result i64)
    (local $sum i64) (local $i i32) (local $n i32)
    local.get $p i32.wrap_i64 local.set $n
    local.get $n i64.load offset=64 local.set $sum
    i32.const 1 memory.grow drop
    local.get $n i64.extend_i32_u i64.const 8 i64.add i32.wrap_i64 i64.load offset=0 local.get $sum i64.add memory.size i64.extend_i32_u i64.const 0 i64.mul i64.add)
)
