;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  (func $mix (param i32) (result i32)
    local.get 0 i32.const 2654435761 i32.mul i32.const 13 i32.rotl)

  ;; A constant is overwritten by a computed state in the same block, and a computed state by a constant. The last store counts.
  (func (export "overwritten") (param $state i32) (param $n i32) (result i32)
    (local $trace i32)
    loop $dispatch
      block $default block $3 block $2 block $1 block $0
      local.get $state
      br_table $0 $1 $2 $3 $default
      end
        local.get $trace i32.const 10 i32.mul i32.const 1 i32.add local.set $trace
        i32.const 3 local.set $state
        local.get $n i32.const 1 i32.and i32.const 1 i32.add local.set $state
        br $dispatch
      end
        local.get $trace i32.const 10 i32.mul i32.const 2 i32.add local.set $trace
        local.get $n i32.const 4 i32.add local.set $state
        i32.const 3 local.set $state
        br $dispatch
      end
        local.get $trace i32.const 10 i32.mul i32.const 3 i32.add local.set $trace
        i32.const 1 local.set $state
        local.get $n i32.const 2 i32.and i32.const 3 i32.add local.set $state
        br $dispatch
      end
        local.get $trace i32.const 10 i32.mul i32.const 4 i32.add local.set $trace
        i32.const 0 local.set $state
        i32.const 4 local.set $state
        br $dispatch
      end
      local.get $trace return
    end
    unreachable)

  ;; What may stand between the store and the branch, and other ways to store and to branch.
  (func (export "between") (param $state i32) (param $n i32) (result i32)
    (local $trace i32)
    loop $dispatch
      block $default block $10 block $9 block $8 block $7 block $6 block $5 block $4 block $3 block $2 block $1 block $0
      local.get $state
      br_table $0 $1 $2 $3 $4 $5 $6 $7 $8 $9 $10 $default
      end
        ;; Values are left on the stack at the branch.
        local.get $trace i32.const 31 i32.mul i32.const 1 i32.add local.set $trace
        local.get $n i64.const 5 f64.const 1.5
        i32.const 1 local.set $state br $dispatch
      end
        ;; The state is read between the store and the branch.
        local.get $trace i32.const 31 i32.mul i32.const 2 i32.add local.set $trace
        i32.const 2 local.set $state
        local.get $state local.get $trace i32.add local.set $trace
        br $dispatch
      end
        ;; The constant is the condition of the branch too, and is not zero.
        local.get $trace i32.const 31 i32.mul i32.const 3 i32.add local.set $trace
        i32.const 3 local.tee $state br_if $dispatch
        i32.const 9 local.set $state br $dispatch
      end
        ;; It is zero, so the branch is not taken.
        local.get $trace i32.const 31 i32.mul i32.const 4 i32.add local.set $trace
        i32.const 0 local.tee $state br_if $dispatch
        i32.const 4 local.set $state br $dispatch
      end
        ;; Both arms store and branch.
        local.get $trace i32.const 31 i32.mul i32.const 5 i32.add local.set $trace
        local.get $n i32.const 1 i32.and
        if
          i32.const 5 local.set $state br $dispatch
        else
          i32.const 6 local.set $state br $dispatch
        end
      end
        ;; A call between the store and the branch.
        local.get $trace i32.const 31 i32.mul i32.const 6 i32.add local.set $trace
        i32.const 7 local.set $state
        local.get $trace call $mix local.set $trace
        br $dispatch
      end
        ;; One of two constants.
        local.get $trace i32.const 31 i32.mul i32.const 7 i32.add local.set $trace
        i32.const 7 i32.const 8 local.get $n i32.const 2 i32.and select local.set $state
        br $dispatch
      end
        ;; A table that leads to the loop.
        local.get $trace i32.const 31 i32.mul i32.const 8 i32.add local.set $trace
        i32.const 8 local.set $state
        local.get $n i32.const 1 i32.and br_table $dispatch $dispatch
      end
        ;; The store is before a block that the branch is in.
        local.get $trace i32.const 31 i32.mul i32.const 9 i32.add local.set $trace
        i32.const 9 local.set $state
        block $skip
          local.get $n i32.const 4 i32.and br_if $skip
          br $dispatch
        end
        i32.const 10 local.set $state br $dispatch
      end
        local.get $trace i32.const 31 i32.mul i32.const 10 i32.add local.set $trace
        i32.const 100 local.set $state br $dispatch
      end
        local.get $trace i32.const 31 i32.mul i32.const 11 i32.add local.set $trace
        i32.const -1 local.set $state br $dispatch
      end
      local.get $trace return
    end
    unreachable)

  ;; A state machine inside a state of another one, on the same local.
  (func (export "sameLocal") (param $state i32) (param $n i32) (result i32)
    (local $trace i32)
    loop $outer
      block $outerDefault block $b block $a
      local.get $state
      br_table $a $b $outerDefault
      end
        local.get $trace i32.const 31 i32.mul i32.const 1 i32.add local.set $trace
        i32.const 0 local.set $state
        block $left
          loop $inner
            block $innerDefault block $1 block $0
            local.get $state
            br_table $0 $1 $innerDefault
            end
              local.get $trace i32.const 31 i32.mul i32.const 2 i32.add local.set $trace
              i32.const 1 local.set $state br $inner
            end
              local.get $trace i32.const 31 i32.mul i32.const 3 i32.add local.set $trace
              local.get $n i32.const 1 i32.sub local.tee $n
              i32.const 0 i32.gt_s
              if
                i32.const 0 local.set $state br $inner
              end
              local.get $n i32.const 1 i32.and
              if
                i32.const 1 local.set $state br $outer
              end
              i32.const 2 local.set $state br $inner
            end
            br $left
          end
          unreachable
        end
        local.get $trace i32.const 31 i32.mul i32.const 4 i32.add local.set $trace
        i32.const 2 local.set $state br $outer
      end
        local.get $trace i32.const 31 i32.mul i32.const 5 i32.add local.set $trace
        i32.const 2 local.set $state br $outer
      end
      local.get $trace return
    end
    unreachable)
)
