;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  (global $sp (mut i32) (i32.const 1000))
  (memory (export "memory") 1)
  (data (i32.const 48) "\09\00\00\00")

  ;; Each begins with a test of $n and tests it again where it is zero. A branch that is never taken leads there too.
  (func $storesPlain (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n
      if
        local.get $n i32.eqz br_if $isZero
        local.get $a local.get $b i32.sub return
      end
    end
    i32.const 16
    local.get $a local.get $b local.get $n select
    i32.store
    i32.const 16 i32.load)
  (func $storesExtended (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n
      if
        local.get $n i64.extend_i32_u i64.eqz br_if $isZero
        local.get $a local.get $b i32.sub return
      end
    end
    i32.const 16
    local.get $a local.get $b local.get $n select
    i32.store
    i32.const 16 i32.load)
  (func $storesMultiplied (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n
      if
        local.get $n i32.eqz local.get $a i32.mul br_if $isZero
        local.get $a local.get $b i32.sub return
      end
    end
    i32.const 16
    local.get $a local.get $b local.get $n select
    i32.store
    i32.const 16 i32.load)
  (func $storesInverted (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n
      if
        local.get $n i32.const 0 i32.ne i32.const 1 i32.xor br_if $isZero
        local.get $a local.get $b i32.sub return
      end
    end
    i32.const 16
    local.get $a local.get $b local.get $n select
    i32.store
    i32.const 16 i32.load)
  (func $subtractsPlain (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n
      if
        local.get $n i32.eqz br_if $isZero
        local.get $a local.get $b i32.sub return
      end
    end
    local.get $a local.get $b local.get $n select
    local.get $b local.get $a i32.const 5 i32.add local.get $n select
    i32.sub)
  (func $subtractsExtended (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n
      if
        local.get $n i64.extend_i32_u i64.eqz br_if $isZero
        local.get $a local.get $b i32.sub return
      end
    end
    local.get $a local.get $b local.get $n select
    local.get $b local.get $a i32.const 5 i32.add local.get $n select
    i32.sub)
  (func $subtractsMultiplied (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n
      if
        local.get $n i32.eqz local.get $a i32.mul br_if $isZero
        local.get $a local.get $b i32.sub return
      end
    end
    local.get $a local.get $b local.get $n select
    local.get $b local.get $a i32.const 5 i32.add local.get $n select
    i32.sub)
  (func $subtractsInverted (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n
      if
        local.get $n i32.const 0 i32.ne i32.const 1 i32.xor br_if $isZero
        local.get $a local.get $b i32.sub return
      end
    end
    local.get $a local.get $b local.get $n select
    local.get $b local.get $a i32.const 5 i32.add local.get $n select
    i32.sub)
  (func $storesExtendedBranch (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n i32.eqz br_if $isZero
      local.get $n i64.extend_i32_u i64.eqz br_if $isZero
      local.get $a local.get $b i32.sub return
    end
    i32.const 16
    local.get $a local.get $b local.get $n select
    i32.store
    i32.const 16 i32.load)
  (func $storesInvertedBranch (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n i32.eqz br_if $isZero
      local.get $n i32.const 0 i32.ne i32.const 1 i32.xor br_if $isZero
      local.get $a local.get $b i32.sub return
    end
    i32.const 16
    local.get $a local.get $b local.get $n select
    i32.store
    i32.const 16 i32.load)
  (func $subtractsExtendedBranch (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n i32.eqz br_if $isZero
      local.get $n i64.extend_i32_u i64.eqz br_if $isZero
      local.get $a local.get $b i32.sub return
    end
    local.get $a local.get $b local.get $n select
    local.get $b local.get $a i32.const 5 i32.add local.get $n select
    i32.sub)
  (func $subtractsInvertedBranch (param $n i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (result i32)
    block $isZero
      local.get $n i32.eqz br_if $isZero
      local.get $n i32.const 0 i32.ne i32.const 1 i32.xor br_if $isZero
      local.get $a local.get $b i32.sub return
    end
    local.get $a local.get $b local.get $n select
    local.get $b local.get $a i32.const 5 i32.add local.get $n select
    i32.sub)

  ;; The other operands of the calls hold zero in a register and compare values after it was set.
  (func (export "oneSelect storesPlain") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $storesPlain)
  (func (export "oneSelect storesExtended") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $storesExtended)
  (func (export "oneSelect storesMultiplied") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $storesMultiplied)
  (func (export "oneSelect storesInverted") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $storesInverted)
  (func (export "oneSelect subtractsPlain") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $subtractsPlain)
  (func (export "oneSelect subtractsExtended") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $subtractsExtended)
  (func (export "oneSelect subtractsMultiplied") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $subtractsMultiplied)
  (func (export "oneSelect subtractsInverted") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $subtractsInverted)
  (func (export "oneSelect storesExtendedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $storesExtendedBranch)
  (func (export "oneSelect storesInvertedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $storesInvertedBranch)
  (func (export "oneSelect subtractsExtendedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $subtractsExtendedBranch)
  (func (export "oneSelect subtractsInvertedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    local.get $r
    local.get $s
    i32.const 0 local.get $p local.get $q select
    call $subtractsInvertedBranch)
  (func (export "threeSelects storesPlain") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $storesPlain)
  (func (export "threeSelects storesExtended") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $storesExtended)
  (func (export "threeSelects storesMultiplied") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $storesMultiplied)
  (func (export "threeSelects storesInverted") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $storesInverted)
  (func (export "threeSelects subtractsPlain") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $subtractsPlain)
  (func (export "threeSelects subtractsExtended") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $subtractsExtended)
  (func (export "threeSelects subtractsMultiplied") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $subtractsMultiplied)
  (func (export "threeSelects subtractsInverted") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $subtractsInverted)
  (func (export "threeSelects storesExtendedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $storesExtendedBranch)
  (func (export "threeSelects storesInvertedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $storesInvertedBranch)
  (func (export "threeSelects subtractsExtendedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $subtractsExtendedBranch)
  (func (export "threeSelects subtractsInvertedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p select
    i32.const 0 i32.const 48 i32.load local.get $q select
    i32.const 0 local.get $s local.get $q select
    call $subtractsInvertedBranch)
  (func (export "comparisons storesPlain") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $storesPlain)
  (func (export "comparisons storesExtended") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $storesExtended)
  (func (export "comparisons storesMultiplied") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $storesMultiplied)
  (func (export "comparisons storesInverted") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $storesInverted)
  (func (export "comparisons subtractsPlain") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $subtractsPlain)
  (func (export "comparisons subtractsExtended") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $subtractsExtended)
  (func (export "comparisons subtractsMultiplied") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $subtractsMultiplied)
  (func (export "comparisons subtractsInverted") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $subtractsInverted)
  (func (export "comparisons storesExtendedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $storesExtendedBranch)
  (func (export "comparisons storesInvertedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $storesInvertedBranch)
  (func (export "comparisons subtractsExtendedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $subtractsExtendedBranch)
  (func (export "comparisons subtractsInvertedBranch") (param $p i32) (param $q i32) (param $r i32) (param $s i32) (result i32)
    i32.const 0 local.get $p
    local.get $q
    i32.const 0 local.get $r local.get $p local.get $q i32.lt_s select
    i32.const 0 i32.const 48 i32.load local.get $q local.get $r i32.gt_u select
    i32.const 0 local.get $s local.get $q local.get $s i32.ge_s select
    call $subtractsInvertedBranch)
)
