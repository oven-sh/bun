(module
  (memory 1 1)
  (func (export "signed") (param i64 f32) (result f32) (local f64)
    local.get 0
    f64.convert_i64_s
    f32.demote_f64)
  (func (export "unsigned") (param i64 f32) (result f32) (local f64)
    local.get 0
    f64.convert_i64_u
    f32.demote_f64)
  (func (export "absolute") (param i64 f32) (result f32) (local f64)
    local.get 0
    f64.convert_i64_s
    f64.abs
    f32.demote_f64)
  (func (export "negated") (param i64 f32) (result f32) (local f64)
    local.get 0
    f64.convert_i64_s
    f64.neg
    f32.demote_f64)
  (func (export "added") (param i64 f32) (result f32) (local f64)
    local.get 0
    f64.convert_i64_s
    local.get 1
    f64.promote_f32
    f64.add
    f32.demote_f64)
  (func (export "selected") (param i64 f32) (result f32) (local f64)
    local.get 0
    f64.convert_i64_s
    local.get 1
    f64.promote_f32
    local.get 0
    i64.const 1
    i64.and
    i32.wrap_i64
    select
    f32.demote_f64)
  (func (export "joined") (param i64 f32) (result f32) (local f64)
    local.get 0
    i64.eqz
    if
    local.get 1
    f64.promote_f32
    local.set 2
    else
    local.get 0
    f64.convert_i64_s
    local.set 2
    end
    local.get 2
    f32.demote_f64)
  (func (export "stored") (param i64 f32) (result f32) (local f64)
    i32.const 0
    local.get 0
    f64.convert_i64_s
    f32.demote_f64
    f32.store
    i32.const 0
    f32.load)
  (func (export "of_sum") (param i64 f32) (result f32) (local f64)
    local.get 0
    i64.const 1
    i64.add
    f64.convert_i64_s
    f32.demote_f64)
  (func (export "of_load") (param i64 f32) (result f32) (local f64)
    i32.const 8
    local.get 0
    i64.store
    i32.const 8
    i64.load
    f64.convert_i64_s
    f32.demote_f64)
  (func (export "directly") (param i64 f32) (result f32) (local f64)
    local.get 0
    f32.convert_i64_s)
  (func (export "narrow") (param i64 f32) (result f32) (local f64)
    local.get 0
    i32.wrap_i64
    f64.convert_i32_s
    f32.demote_f64)
  (func (export "narrow_unsigned") (param i64 f32) (result f32) (local f64)
    local.get 0
    i32.wrap_i64
    f64.convert_i32_u
    f32.demote_f64))
