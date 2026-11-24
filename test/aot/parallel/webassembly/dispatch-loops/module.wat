;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: multi-value.
(module
  ;; A state machine as Go's compiler writes one: the first parameter says where to resume, and each jump stores the next state as a constant and branches back to the table.
  (func $sumBelow (export "sumBelow") (param $state i32) (param $n i32) (result i32)
    (local $i i32) (local $sum i32)
    loop $dispatch
      block $default block $3 block $2 block $1 block $0
      local.get $state
      br_table $0 $1 $2 $3 $default
      end
        i32.const 0 local.set $i
        i32.const 0 local.set $sum
        i32.const 2 local.set $state br $dispatch
      end
        local.get $sum local.get $i i32.add local.set $sum
        local.get $i i32.const 1 i32.add local.set $i
      end
        local.get $i local.get $n i32.lt_s
        if
          i32.const 1 local.set $state br $dispatch
        end
        i32.const 3 local.set $state br $dispatch
      end
        local.get $sum return
      end
      i32.const -1 return
    end
    unreachable)

  ;; The caller passes the state as a constant, so a compiler that inlines the callee knows where it starts.
  (func (export "sumBelowFromStart") (param $n i32) (result i32)
    i32.const 0 local.get $n call $sumBelow)
  (func (export "sumBelowFromTest") (param $n i32) (result i32)
    i32.const 2 local.get $n call $sumBelow)

  ;; Ten states, so the table is a table of jumps. Locals of every numeric type live across the states.
  (func (export "mixed") (param $state i32) (param $n i32) (result f64)
    (local $a i32) (local $b i64) (local $c f32) (local $d f64)
    loop $dispatch
      block $default block $9 block $8 block $7 block $6 block $5 block $4 block $3 block $2 block $1 block $0
      local.get $state
      br_table $0 $1 $2 $3 $4 $5 $6 $7 $8 $9 $default
      end
        i32.const 1 local.set $a
        i64.const 1 local.set $b
        f32.const 1 local.set $c
        f64.const 1 local.set $d
        i32.const 5 local.set $state br $dispatch
      end
        local.get $a i32.const 3 i32.mul i32.const 1 i32.add local.set $a
        i32.const 6 local.set $state br $dispatch
      end
        local.get $b i64.const 1099511628211 i64.mul local.get $a i64.extend_i32_s i64.xor local.set $b
        i32.const 7 local.set $state br $dispatch
      end
        local.get $c f32.const 1.5 f32.mul local.set $c
        i32.const 8 local.set $state br $dispatch
      end
        local.get $d local.get $c f64.promote_f32 f64.add local.set $d
        i32.const 9 local.set $state br $dispatch
      end
        local.get $n i32.eqz
        if
          i32.const 100 local.set $state br $dispatch
        end
        local.get $n i32.const 1 i32.sub local.set $n
        i32.const 1 local.set $state br $dispatch
      end
        local.get $a i32.const 1 i32.and
        if
          i32.const 2 local.set $state br $dispatch
        end
        i32.const 3 local.set $state br $dispatch
      end
        i32.const 3 local.set $state br $dispatch
      end
        i32.const 4 local.set $state br $dispatch
      end
        i32.const 5 local.set $state br $dispatch
      end
      local.get $d local.get $b i64.const 1048575 i64.and f64.convert_i64_s f64.add local.get $a f64.convert_i32_s f64.add return
    end
    unreachable)

  ;; br_if to the table right after the store. Where the branch is not taken the stored state must not matter.
  (func (export "conditional") (param $state i32) (param $n i32) (result i32)
    (local $steps i32)
    loop $dispatch
      block $default block $2 block $1 block $0
      local.get $state
      br_table $0 $1 $2 $default
      end
        local.get $steps i32.const 1 i32.add local.set $steps
        i32.const 1 local.set $state
        local.get $n i32.const 1 i32.and
        br_if $dispatch
        i32.const 2 local.set $state
        br $dispatch
      end
        local.get $steps i32.const 10 i32.add local.set $steps
        local.get $n i32.const 1 i32.shr_u local.tee $n
        i32.eqz
        if
          i32.const 3 local.set $state br $dispatch
        end
        i32.const 0 local.set $state br $dispatch
      end
        local.get $steps i32.const 100 i32.add local.set $steps
        local.get $n i32.const 1 i32.shr_u local.tee $n
        i32.eqz
        if
          i32.const -1 local.set $state br $dispatch
        end
        i32.const 0 local.set $state br $dispatch
      end
      local.get $steps return
    end
    unreachable)

  ;; The next state is computed, so it goes through the table.
  (func (export "computed") (param $state i32) (param $n i32) (result i32)
    (local $hash i32)
    loop $dispatch
      block $default block $3 block $2 block $1 block $0
      local.get $state
      br_table $0 $1 $2 $3 $default
      end local.get $hash i32.const 31 i32.mul i32.const 1 i32.add local.set $hash br $default
      end local.get $hash i32.const 31 i32.mul i32.const 2 i32.add local.set $hash br $default
      end local.get $hash i32.const 31 i32.mul i32.const 3 i32.add local.set $hash br $default
      end local.get $hash i32.const 31 i32.mul i32.const 4 i32.add local.set $hash
      end
      local.get $n i32.eqz
      if
        local.get $hash return
      end
      local.get $n i32.const 1 i32.sub local.set $n
      local.get $hash local.get $n i32.add i32.const 3 i32.and local.set $state
      br $dispatch
    end
    unreachable)

  ;; The store is in an earlier block than the branch, is overwritten in the same block, or comes from local.tee.
  (func (export "stores") (param $state i32) (param $n i32) (result i32)
    (local $trace i32)
    loop $dispatch
      block $default block $4 block $3 block $2 block $1 block $0
      local.get $state
      br_table $0 $1 $2 $3 $4 $default
      end
        local.get $trace i32.const 10 i32.mul i32.const 1 i32.add local.set $trace
        i32.const 1 local.set $state
        local.get $n
        if
          br $dispatch
        end
        i32.const 4 local.set $state
        br $dispatch
      end
        local.get $trace i32.const 10 i32.mul i32.const 2 i32.add local.set $trace
        i32.const 4 local.set $state
        i32.const 2 local.set $state
        br $dispatch
      end
        local.get $trace i32.const 10 i32.mul i32.const 3 i32.add local.set $trace
        i32.const 3 local.tee $state drop
        br $dispatch
      end
        local.get $trace i32.const 10 i32.mul i32.const 4 i32.add local.set $trace
        i32.const 2 local.set $n
        i32.const 4 local.set $state
        local.get $n local.set $n
        br $dispatch
      end
        local.get $trace i32.const 10 i32.mul i32.const 5 i32.add local.set $trace
        local.get $n local.set $state
        i32.const 9 local.set $n
        local.get $state i32.const 5 i32.add local.set $state
        br $dispatch
      end
      local.get $trace return
    end
    unreachable)

  ;; The header does more than switch: it counts how often it runs. No branch may skip that.
  (func (export "countsDispatches") (param $state i32) (result i32)
    (local $count i32)
    loop $dispatch
      local.get $count i32.const 1 i32.add local.set $count
      block $default block $2 block $1 block $0
      local.get $state
      br_table $0 $1 $2 $default
      end i32.const 1 local.set $state br $dispatch
      end i32.const 2 local.set $state br $dispatch
      end i32.const 3 local.set $state br $dispatch
      end
      local.get $count return
    end
    unreachable)

  ;; The loop takes a parameter, so each branch to it passes a value.
  (func (export "loopWithParameter") (param $state i32) (result i32)
    i32.const 0
    loop $dispatch (param i32) (result i32)
      i32.const 10 i32.mul
      block $default (param i32) (result i32) block $2 (param i32) (result i32) block $1 (param i32) (result i32) block $0 (param i32) (result i32)
      local.get $state
      br_table $0 $1 $2 $default
      end i32.const 1 i32.add i32.const 1 local.set $state br $dispatch
      end i32.const 2 i32.add i32.const 2 local.set $state br $dispatch
      end i32.const 3 i32.add i32.const 3 local.set $state br $dispatch
      end
    end)

  ;; The table passes a value to its targets.
  (func (export "tableWithValue") (param $state i32) (result i32)
    (local $sum i32)
    loop $dispatch
      block $default (result i32) block $2 (result i32) block $1 (result i32) block $0 (result i32)
      local.get $sum
      local.get $state
      br_table $0 $1 $2 $default
      end i32.const 1 i32.add local.set $sum i32.const 1 local.set $state br $dispatch
      end i32.const 20 i32.add local.set $sum i32.const 2 local.set $state br $dispatch
      end i32.const 300 i32.add local.set $sum i32.const 3 local.set $state br $dispatch
      end
      return
    end
    unreachable)

  ;; The constant is stored in another local than the one the table reads.
  (func (export "otherLocal") (param $state i32) (param $other i32) (result i32)
    (local $trace i32)
    loop $dispatch
      block $default block $2 block $1 block $0
      local.get $state
      br_table $0 $1 $2 $default
      end
        local.get $trace i32.const 10 i32.mul i32.const 1 i32.add local.set $trace
        local.get $other i32.const 1 i32.add local.set $state
        i32.const 0 local.set $other
        br $dispatch
      end
        local.get $trace i32.const 10 i32.mul i32.const 2 i32.add local.set $trace
        i32.const 2 local.set $state
        i32.const 1 local.set $other
        br $dispatch
      end
        local.get $trace i32.const 10 i32.mul i32.const 3 i32.add local.set $trace
        i32.const 3 local.set $state
        br $dispatch
      end
      local.get $trace local.get $other i32.add return
    end
    unreachable)

  ;; A state machine inside a state of another one. The inner one branches to both tables.
  (func (export "nested") (param $outer i32) (param $inner i32) (param $n i32) (result i32)
    (local $trace i32)
    loop $outerDispatch
      block $outerDefault block $b block $a
      local.get $outer
      br_table $a $b $outerDefault
      end
        loop $innerDispatch
          block $innerDefault block $2 block $1 block $0
          local.get $inner
          br_table $0 $1 $2 $innerDefault
          end
            local.get $trace i32.const 1 i32.add local.set $trace
            i32.const 1 local.set $inner br $innerDispatch
          end
            local.get $trace i32.const 10 i32.add local.set $trace
            local.get $n i32.const 1 i32.sub local.tee $n
            i32.const 0 i32.gt_s
            if
              i32.const 0 local.set $inner br $innerDispatch
            end
            i32.const 2 local.set $inner br $innerDispatch
          end
            local.get $trace i32.const 100 i32.add local.set $trace
            i32.const 3 local.set $inner
            i32.const 1 local.set $outer br $outerDispatch
          end
          local.get $trace i32.const 1000 i32.add local.set $trace
          i32.const 2 local.set $outer br $outerDispatch
        end
        unreachable
      end
        local.get $trace i32.const 10000 i32.add local.set $trace
        i32.const 0 local.set $outer br $outerDispatch
      end
      local.get $trace return
    end
    unreachable)

  ;; One case of the table is the loop itself, and one state leaves the loop through an outer block.
  (func (export "tableNamesLoop") (param $state i32) (param $spin i32) (result i32)
    block $out
      loop $dispatch
        block $1 block $0
        local.get $state
        br_table $0 $1 $dispatch $out
        end
          local.get $spin
          if
            i32.const 2 local.set $state br $dispatch
          end
          i32.const 1 local.set $state br $dispatch
        end
        i32.const 3 local.set $state br $dispatch
      end
      unreachable
    end
    local.get $state)
)
