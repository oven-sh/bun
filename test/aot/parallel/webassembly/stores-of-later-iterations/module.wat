(module
  (memory (export "memory") 1 1)
  (global (mut i32) (i32.const 0))
  (func (export "word") (param i32)
    loop
      local.get 0
      i32.const 1
      i32.store
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      i32.const 2
      i32.store
      local.get 0
      i32.const 4
      i32.add
      local.set 0
      br 0
    end)
  (func (export "byte") (param i32)
    loop
      local.get 0
      i32.const 1
      i32.store8
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      i32.const 2
      i32.store8
      local.get 0
      i32.const 1
      i32.add
      local.set 0
      br 0
    end)
  (func (export "half") (param i32)
    loop
      local.get 0
      i32.const 1
      i32.store16
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      i32.const 2
      i32.store16
      local.get 0
      i32.const 2
      i32.add
      local.set 0
      br 0
    end)
  (func (export "long") (param i32)
    loop
      local.get 0
      i64.const 1
      i64.store
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      i64.const 2
      i64.store
      local.get 0
      i32.const 8
      i32.add
      local.set 0
      br 0
    end)
  (func (export "byte_of_long") (param i32)
    loop
      local.get 0
      i64.const 1
      i64.store8
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      i64.const 2
      i64.store8
      local.get 0
      i32.const 1
      i32.add
      local.set 0
      br 0
    end)
  (func (export "half_of_long") (param i32)
    loop
      local.get 0
      i64.const 1
      i64.store16
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      i64.const 2
      i64.store16
      local.get 0
      i32.const 2
      i32.add
      local.set 0
      br 0
    end)
  (func (export "word_of_long") (param i32)
    loop
      local.get 0
      i64.const 1
      i64.store32
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      i64.const 2
      i64.store32
      local.get 0
      i32.const 4
      i32.add
      local.set 0
      br 0
    end)
  (func (export "float") (param i32)
    loop
      local.get 0
      f32.const 1
      f32.store
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      f32.const 2
      f32.store
      local.get 0
      i32.const 4
      i32.add
      local.set 0
      br 0
    end)
  (func (export "double") (param i32)
    loop
      local.get 0
      f64.const 1
      f64.store
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      f64.const 2
      f64.store
      local.get 0
      i32.const 8
      i32.add
      local.set 0
      br 0
    end)
  (func (export "with_offset") (param i32)
    loop
      local.get 0
      i32.const 1
      i32.store offset=1024
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      i32.const 2
      i32.store offset=1024
      local.get 0
      i32.const 4
      i32.add
      local.set 0
      br 0
    end)
  (func (export "far_steps") (param i32)
    loop
      local.get 0
      i32.const 1
      i32.store
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      i32.const 2
      i32.store
      local.get 0
      i32.const 4096
      i32.add
      local.set 0
      br 0
    end)
  (func (export "downward") (param i32)
    loop
      local.get 0
      i32.const 1
      i32.store
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      i32.const 2
      i32.store
      local.get 0
      i32.const -4
      i32.add
      local.set 0
      br 0
    end)
  (func (export "read_of_address") (param i32)
    loop
      local.get 0
      i32.const 1
      i32.store
      local.get 0
      i32.load offset=32
      global.set 0
      local.get 0
      i32.const 2
      i32.store
      local.get 0
      i32.const 4
      i32.add
      local.set 0
      br 0
    end)
  (func (export "two_blocks") (param i32)
    loop
      local.get 0
      i32.const 1
      i32.store
      i32.const 65535
      i32.load8_u
      global.set 0
      local.get 0
      i32.const 2
      i32.store
      local.get 0
      i32.const 64
      i32.and
      if
        local.get 0
        i32.const 8
        i32.add
        local.set 0
      else
        local.get 0
        i32.const 4
        i32.add
        local.set 0
      end
      br 0
    end)
  (func (export "fixed_address") (param i32)
    loop
      i32.const 64
      i32.const 1
      i32.store
      i32.const 65535
      i32.load8_u
      global.set 0
      i32.const 64
      i32.const 2
      i32.store
      local.get 0
      i32.load
      drop
      local.get 0
      i32.const 4096
      i32.add
      local.set 0
      br 0
    end)
  (func (export "with_exit") (param i32)
    block
      loop
        local.get 0
        i32.const 1
        i32.store
        i32.const 65535
        i32.load8_u
        global.set 0
        local.get 0
        i32.const 2
        i32.store
        local.get 0
        i32.const 4
        i32.add
        local.tee 0
        i32.const 128
        i32.eq
        br_if 1
        br 0
      end
    end))
