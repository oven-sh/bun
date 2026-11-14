(module
  (memory 1 1)
  (func (export "pair") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    f64.promote_f32
    f32.demote_f64
    i32.reinterpret_f32)
  (func (export "neg") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    f64.promote_f32
    f64.neg
    f32.demote_f64
    i32.reinterpret_f32)
  (func (export "abs") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    f64.promote_f32
    f64.abs
    f32.demote_f64
    i32.reinterpret_f32)
  (func (export "neg_abs") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    f64.promote_f32
    f64.abs
    f64.neg
    f32.demote_f64
    i32.reinterpret_f32)
  (func (export "joined") (param i32 i32) (result i32) (local f64)
    local.get 1
    if
    local.get 0
    f32.reinterpret_i32
    f64.promote_f32
    local.set 2
    else
    f64.const 0.5
    local.set 2
    end
    local.get 2
    f32.demote_f64
    i32.reinterpret_f32)
  (func (export "joined_neg") (param i32 i32) (result i32) (local f64)
    local.get 1
    if
    local.get 0
    f32.reinterpret_i32
    f64.promote_f32
    local.set 2
    else
    f64.const 0.5
    local.set 2
    end
    local.get 2
    f64.neg
    f32.demote_f64
    i32.reinterpret_f32)
  (func (export "selected") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    f64.promote_f32
    f64.const 0.5
    local.get 1
    select
    f32.demote_f64
    i32.reinterpret_f32)
  (func (export "stored") (param i32 i32) (result i32) (local f64)
    i32.const 0
    local.get 0
    f32.reinterpret_i32
    f64.promote_f32
    f32.demote_f64
    f32.store
    i32.const 0
    i32.load)
  (func (export "min_one") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    f32.const 1
    f32.min
    i32.reinterpret_f32)
  (func (export "max_one") (param i32 i32) (result i32) (local f64)
    f32.const 1
    local.get 0
    f32.reinterpret_i32
    f32.max
    i32.reinterpret_f32)
  (func (export "min_zero") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    f32.const 0
    f32.min
    i32.reinterpret_f32)
  (func (export "max_negative_zero") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    f32.const -0
    f32.max
    i32.reinterpret_f32)
  (func (export "plain") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    i32.reinterpret_f32)
  (func (export "float_neg") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    f32.neg
    i32.reinterpret_f32)
  (func (export "float_abs") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    f32.abs
    i32.reinterpret_f32)
  (func (export "root") (param i32 i32) (result i32) (local f64)
    local.get 0
    f32.reinterpret_i32
    f64.promote_f32
    f64.abs
    f64.sqrt
    f32.demote_f64
    i32.reinterpret_f32))
