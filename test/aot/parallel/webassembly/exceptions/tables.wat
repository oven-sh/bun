;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: exception-handling (try_table, throw_ref, exnref).
(module
  (import "env" "fail" (func $fail (param i32)))
  (tag $value (export "value") (param i32))
  (tag $other)
  (func $throwValue (param i32) (throw $value (local.get 0)))
  (func (export "catches") (param i32) (result i32)
    block $caught (result i32)
      try_table (catch $value $caught)
        local.get 0 call $throwValue
      end
      i32.const -1
    end)
  (func (export "catchesAll") (param i32) (result i32)
    block $caught
      try_table (catch_all $caught)
        local.get 0 call $fail
      end
      i32.const 0 return
    end
    i32.const 1)
  (func (export "catchesRefAndThrowsAgain") (param i32) (result i32)
    (local $e exnref)
    block $outer (result i32)
      try_table (catch $value $outer)
        block $inner (result i32 exnref)
          try_table (catch_ref $value $inner)
            local.get 0 call $throwValue
          end
          i32.const -1 return
        end
        local.set $e
        drop
        local.get $e throw_ref
      end
      i32.const -2
    end
    i32.const 100 i32.add)
  (func (export "catchesAllRef") (result i32)
    block $caught (result exnref)
      try_table (catch_all_ref $caught)
        throw $other
      end
      i32.const 0 return
    end
    ref.is_null i32.eqz)
  (func (export "throwsNull") (local $e exnref) local.get $e throw_ref)
  (func (export "firstMatch") (param i32) (result i32)
    block $all
      block $o
        block $v (result i32)
          try_table (catch $value $v) (catch $other $o) (catch_all $all)
            local.get 0 i32.eqz if throw $other end
            local.get 0 i32.const 1 i32.eq if i32.const 7 throw $value end
            local.get 0 call $fail
          end
          i32.const 0 return
        end
        return
      end
      i32.const 20 return
    end
    i32.const 30)
  (func (export "letsOut") (param i32) local.get 0 call $throwValue)
)
