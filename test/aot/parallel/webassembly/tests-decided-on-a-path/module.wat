(module
  (import "env" "hook" (func))
  (memory 1)
  (global (mut i32) (i32.const 65536))
  (func (export "grow_wide") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    i32.const 0
    memory.grow
    drop
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i64.const -5
    i64.eqz
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "grow_wide_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    i32.const 0
    memory.grow
    drop
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i64.const -5
    i64.eqz
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "grow_word") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    i32.const 0
    memory.grow
    drop
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i32.const 7
    i32.eqz
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "grow_word_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    i32.const 0
    memory.grow
    drop
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i32.const 7
    i32.eqz
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "grow_compared") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    i32.const 0
    memory.grow
    drop
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i32.const 3
    i32.const 4
    i32.eq
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "grow_compared_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    i32.const 0
    memory.grow
    drop
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i32.const 3
    i32.const 4
    i32.eq
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "grow_shifted") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    i32.const 0
    memory.grow
    drop
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i64.const 1
    i64.const 8
    i64.shr_u
    i32.wrap_i64
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "grow_shifted_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    i32.const 0
    memory.grow
    drop
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i64.const 1
    i64.const 8
    i64.shr_u
    i32.wrap_i64
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "call_wide") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    call 0
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i64.const -5
    i64.eqz
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "call_wide_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    call 0
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i64.const -5
    i64.eqz
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "call_word") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    call 0
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i32.const 7
    i32.eqz
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "call_word_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    call 0
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i32.const 7
    i32.eqz
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "call_compared") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    call 0
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i32.const 3
    i32.const 4
    i32.eq
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "call_compared_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    call 0
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i32.const 3
    i32.const 4
    i32.eq
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "call_shifted") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    call 0
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i64.const 1
    i64.const 8
    i64.shr_u
    i32.wrap_i64
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "call_shifted_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    call 0
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i64.const 1
    i64.const 8
    i64.shr_u
    i32.wrap_i64
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "store_wide") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    i32.const 8
    local.get 0
    i32.store
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i64.const -5
    i64.eqz
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "store_wide_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    i32.const 8
    local.get 0
    i32.store
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i64.const -5
    i64.eqz
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "store_word") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    i32.const 8
    local.get 0
    i32.store
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i32.const 7
    i32.eqz
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "store_word_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    i32.const 8
    local.get 0
    i32.store
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i32.const 7
    i32.eqz
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "store_compared") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    i32.const 8
    local.get 0
    i32.store
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i32.const 3
    i32.const 4
    i32.eq
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "store_compared_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    i32.const 8
    local.get 0
    i32.store
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i32.const 3
    i32.const 4
    i32.eq
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "store_shifted") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    i32.const 8
    local.get 0
    i32.store
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i64.const 1
    i64.const 8
    i64.shr_u
    i32.wrap_i64
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "store_shifted_value") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 9
    local.get 2
    br_if 0
    drop
    i32.const 8
    local.get 0
    i32.store
    i32.const 8
    end
    local.set 4
    block (result i32)
    i32.const 7
    i64.const 1
    i64.const 8
    i64.shr_u
    i32.wrap_i64
    br_if 0
    drop
    local.get 2
    i32.eqz
    if (result i32)
    i32.const 3
    else
    i32.const 0
    end
    end
    local.tee 3
    if
    local.get 3
    local.get 4
    i32.add
    return
    end
    local.get 4)
  (func (export "without_dead_branch") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    local.get 2
    i32.eqz
    if (result i32).const 0
    memory.grow
    drop
    end
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "without_test_before") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    i64.const -5
    i64.eqz
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
  (func (export "branch_taken") (param i32 i32) (result i32) (local i32 i32 i32)
    i32.const 0
    i32.const -590730549
    local.get 1
    select
    local.set 2
    block (result i32)
    i32.const 0
    local.get 2
    br_if 0
    drop
    i32.const 0
    memory.grow
    drop
    i32.const 0
    end
    drop
    block (result i32)
    i32.const 0
    i64.const 0
    i64.eqz
    br_if 0
    drop
    local.get 2
    if (result i32)
    i32.const 0
    else
    i32.const 1
    end
    end
    if (result i32).const 5
    local.set 3
    end
    local.get 3)
)
