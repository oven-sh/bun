(module
  (memory 1 2)
  (global (mut i32) (i32.const 65536))
  ;; bytes of 65500 to 65535: 129, 166, 203, ..: 37 more each
  (func (export "low_byte") (param i32) (result i32)
    local.get 0
    i32.load
    i32.const 255
    i32.and)
  (func (export "low_half") (param i32) (result i32)
    local.get 0
    i32.load
    i32.const 65535
    i32.and)
  (func (export "extended_byte") (param i32) (result i32)
    local.get 0
    i32.load
    i32.extend8_s)
  (func (export "extended_half") (param i32) (result i32)
    local.get 0
    i32.load
    i32.extend16_s)
  (func (export "shifted_byte") (param i32) (result i32)
    local.get 0
    i32.load
    i32.const 24
    i32.shl
    i32.const 24
    i32.shr_s)
  (func (export "compared_half") (param i32) (result i32)
    local.get 0
    i32.load
    i32.const 65535
    i32.and
    i32.const 3
    i32.eq
    if (result
    i32)
    i32.const 1
    else
    i32.const 2
    end)
  (func (export "byte_of_wide") (param i32) (result i32)
    local.get 0
    i64.load
    i32.wrap_i64
    i32.const 255
    i32.and)
  (func (export "wide_byte") (param i32) (result i32)
    local.get 0
    i64.load32_u
    i64.const 255
    i64.and
    i32.wrap_i64)
  (func (export "wide_extended_byte") (param i32) (result i32)
    local.get 0
    i64.load32_s
    i64.extend8_s
    i32.wrap_i64)
  (func (export "wide_extended_half") (param i32) (result i32)
    local.get 0
    i64.load32_u
    i64.extend16_s
    i32.wrap_i64)
  (func (export "tested_wide") (param i32) (result i32)
    local.get 0
    i64.load
    i64.const 256
    i64.and
    i64.eqz
    if (result
    i32)
    i32.const 1
    else
    i32.const 2
    end)
  (func (export "tested_wide_inverted") (param i32) (result i32)
    local.get 0
    i64.load
    i64.const 256
    i64.and
    i64.const 0
    i64.ne
    if (result
    i32)
    i32.const 1
    else
    i32.const 2
    end)
  (func (export "tested_word") (param i32) (result i32)
    local.get 0
    i32.load
    i32.const 256
    i32.and
    if (result
    i32)
    i32.const 1
    else
    i32.const 2
    end)
  (func (export "low_word") (param i32) (result i32)
    local.get 0
    i64.load
    i32.wrap_i64)
  (func (export "loaded_byte") (param i32) (result i32)
    local.get 0
    i32.load8_u
    i32.const 255
    i32.and)
  (func (export "loaded_half") (param i32) (result i32)
    local.get 0
    i32.load16_u
    i32.const 65535
    i32.and)
  (func (export "loaded_signed") (param i32) (result i32)
    local.get 0
    i32.load8_s)
  (func (export "tested_byte") (param i32) (result i32)
    local.get 0
    i32.load8_u
    i32.const 16
    i32.and
    if (result
    i32)
    i32.const 1
    else
    i32.const 2
    end)
  (func (export "between_stores") (param i32) (result i32)
    i32.const 8
    i32.const 1
    i32.store
    local.get 0
    i32.load
    i32.const 255
    i32.and
    i32.const 8
    i32.const 2
    i32.store)
  (func (export "stored") (param i32) (result i32)
    i32.const 8
    i32.load)
)
