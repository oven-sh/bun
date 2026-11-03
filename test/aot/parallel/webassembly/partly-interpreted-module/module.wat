;; Source of module.wasm. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: tail calls, exception handling (try_table).
;; Interpreted in an image: sumTo, countDown, spread, tailDivide, tailViaTable (tail calls), throwIf, catcher, catchAll, catchAllDivide (exceptions). The other ten functions are compiled.
(module
  (type (;0;) (func (param i32) (result i32)))
  (type (;1;) (func (param i32 i32) (result i32)))
  (type (;2;) (func (param i32)))
  (type (;3;) (func (param i32 i32 i32 i32 i32 i32 i32 i32 i32 i32) (result i32)))
  (import "env" "fail" (func $fail (type 2)))
  (table 4 funcref)
  (tag (type 2))
  (export "sumTo" (func $sumTo))
  (export "step" (func $step))
  (export "sum" (func $sum))
  (export "countDown" (func $countDown))
  (export "count" (func $count))
  (export "sumOfTen" (func $sumOfTen))
  (export "spread" (func $spread))
  (export "callSpread" (func $callSpread))
  (export "throwIf" (func $throwIf))
  (export "middle" (func $middle))
  (export "catcher" (func $catcher))
  (export "callFail" (func $callFail))
  (export "catchAll" (func $catchAll))
  (export "divide" (func $divide))
  (export "tailDivide" (func $tailDivide))
  (export "catchAllDivide" (func $catchAllDivide))
  (export "triple" (func $triple))
  (export "viaTable" (func $viaTable))
  (export "tailViaTable" (func $tailViaTable))
  (export "oops" (tag 0))
  (elem (i32.const 0) func $triple $spread $throwIf $callSpread)

  ;; sumTo(n, total) = total + n + ... + 1, mutually recursive with step.
  (func $sumTo (type 1)
    local.get 0
    i32.eqz
    if
      local.get 1
      return
    end
    local.get 0
    local.get 1
    return_call $step)

  (func $step (type 1)
    local.get 0
    i32.const 1
    i32.sub
    local.get 1
    local.get 0
    i32.add
    call $sumTo)

  (func $sum (type 0)
    local.get 0
    i32.const 0
    call $sumTo)

  ;; The same sum in constant stack space.
  (func $countDown (type 1)
    local.get 0
    i32.eqz
    if
      local.get 1
      return
    end
    local.get 0
    i32.const 1
    i32.sub
    local.get 1
    local.get 0
    i32.add
    return_call $countDown)

  (func $count (type 0)
    local.get 0
    i32.const 0
    call $countDown
    i32.const 1
    i32.add)

  ;; 1 * a + 2 * b + ... + 10 * j: more parameters than argument registers.
  (func $sumOfTen (type 3)
    local.get 0
    local.get 1
    i32.const 2
    i32.mul
    i32.add
    local.get 2
    i32.const 3
    i32.mul
    i32.add
    local.get 3
    i32.const 4
    i32.mul
    i32.add
    local.get 4
    i32.const 5
    i32.mul
    i32.add
    local.get 5
    i32.const 6
    i32.mul
    i32.add
    local.get 6
    i32.const 7
    i32.mul
    i32.add
    local.get 7
    i32.const 8
    i32.mul
    i32.add
    local.get 8
    i32.const 9
    i32.mul
    i32.add
    local.get 9
    i32.const 10
    i32.mul
    i32.add)

  (func $spread (type 0)
    local.get 0
    local.get 0
    i32.const 1
    i32.add
    local.get 0
    i32.const 2
    i32.add
    local.get 0
    i32.const 3
    i32.add
    local.get 0
    i32.const 4
    i32.add
    local.get 0
    i32.const 5
    i32.add
    local.get 0
    i32.const 6
    i32.add
    local.get 0
    i32.const 7
    i32.add
    local.get 0
    i32.const 8
    i32.add
    local.get 0
    i32.const 9
    i32.add
    return_call $sumOfTen)

  ;; Four values are live across the call.
  (func $callSpread (type 0) (local i32 i32 i32 i32)
    local.get 0
    i32.const 3
    i32.mul
    i32.const 1
    i32.add
    local.set 1
    local.get 0
    i32.const 5
    i32.mul
    i32.const 2
    i32.add
    local.set 2
    local.get 0
    i32.const 7
    i32.mul
    i32.const 3
    i32.add
    local.set 3
    local.get 0
    i32.const 9
    i32.mul
    i32.const 4
    i32.add
    local.set 4
    local.get 0
    call $spread
    local.get 1
    i32.add
    local.get 2
    i32.add
    local.get 3
    i32.add
    local.get 4
    i32.add)

  (func $throwIf (type 0)
    local.get 0
    if
      local.get 0
      throw 0
    end
    i32.const 7)

  ;; Eight values are live across a call that may throw: the exception crosses this frame.
  (func $middle (type 0) (local i32 i32 i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 3
    i32.mul
    i32.const 1
    i32.add
    local.set 1
    local.get 0
    i32.const 5
    i32.mul
    i32.const 2
    i32.add
    local.set 2
    local.get 0
    i32.const 7
    i32.mul
    i32.const 3
    i32.add
    local.set 3
    local.get 0
    i32.const 9
    i32.mul
    i32.const 4
    i32.add
    local.set 4
    local.get 0
    i32.const 11
    i32.mul
    i32.const 5
    i32.add
    local.set 5
    local.get 0
    i32.const 13
    i32.mul
    i32.const 6
    i32.add
    local.set 6
    local.get 0
    i32.const 15
    i32.mul
    i32.const 7
    i32.add
    local.set 7
    local.get 0
    i32.const 17
    i32.mul
    i32.const 8
    i32.add
    local.set 8
    local.get 0
    call $throwIf
    local.get 1
    i32.add
    local.get 2
    i32.add
    local.get 3
    i32.add
    local.get 4
    i32.add
    local.get 5
    i32.add
    local.get 6
    i32.add
    local.get 7
    i32.add
    local.get 8
    i32.add)

  ;; middle(x), or 1000 + the exception's payload.
  (func $catcher (type 0)
    block (result i32)
      try_table (result i32) (catch 0 0)
        local.get 0
        call $middle
      end
      return
    end
    i32.const 1000
    i32.add)

  ;; Eight values are live across a call of a JavaScript function that may throw.
  (func $callFail (type 0) (local i32 i32 i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 3
    i32.mul
    i32.const 1
    i32.add
    local.set 1
    local.get 0
    i32.const 5
    i32.mul
    i32.const 2
    i32.add
    local.set 2
    local.get 0
    i32.const 7
    i32.mul
    i32.const 3
    i32.add
    local.set 3
    local.get 0
    i32.const 9
    i32.mul
    i32.const 4
    i32.add
    local.set 4
    local.get 0
    i32.const 11
    i32.mul
    i32.const 5
    i32.add
    local.set 5
    local.get 0
    i32.const 13
    i32.mul
    i32.const 6
    i32.add
    local.set 6
    local.get 0
    i32.const 15
    i32.mul
    i32.const 7
    i32.add
    local.set 7
    local.get 0
    i32.const 17
    i32.mul
    i32.const 8
    i32.add
    local.set 8
    local.get 0
    call $fail
    local.get 0
    local.get 1
    i32.add
    local.get 2
    i32.add
    local.get 3
    i32.add
    local.get 4
    i32.add
    local.get 5
    i32.add
    local.get 6
    i32.add
    local.get 7
    i32.add
    local.get 8
    i32.add)

  (func $catchAll (type 0)
    block
      try_table (catch_all 0)
        local.get 0
        call $callFail
        return
      end
    end
    i32.const -1)

  (func $divide (type 1)
    local.get 0
    local.get 1
    i32.div_s)

  (func $tailDivide (type 1)
    local.get 0
    local.get 1
    return_call $divide)

  ;; A trap is not caught.
  (func $catchAllDivide (type 1)
    block
      try_table (catch_all 0)
        local.get 0
        local.get 1
        call $divide
        return
      end
    end
    i32.const -2)

  (func $triple (type 0)
    local.get 0
    i32.const 3
    i32.mul)

  (func $viaTable (type 1)
    local.get 1
    local.get 0
    call_indirect (type 0))

  (func $tailViaTable (type 1)
    local.get 1
    local.get 0
    return_call_indirect (type 0))
)
