(module
  (memory (export "memory") 1)
  (global (mut i32) (i32.const 65536))
  (func (export "add_0_at_0_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_0_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 2
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_0_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 3
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_0_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 4
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_0_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 5
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_2_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 0
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_2_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 1
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_2_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 3
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_2_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 4
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_2_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 5
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_5_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 0
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_5_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 1
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_5_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 2
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_5_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 3
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_0_at_5_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 4
    i32.atomic.rmw8.add_u offset=0
    drop)
  (func (export "add_8_at_0_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_0_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 2
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_0_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 3
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_0_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 4
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_0_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 5
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_2_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 0
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_2_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 1
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_2_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 3
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_2_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 4
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_2_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 5
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_5_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 0
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_5_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 1
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_5_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 2
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_5_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 3
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_8_at_5_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 4
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "sub_0_at_0_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_0_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 2
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_0_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 3
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_0_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 4
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_0_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 5
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_2_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 0
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_2_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 1
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_2_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 3
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_2_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 4
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_2_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 5
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_5_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 0
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_5_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 1
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_5_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 2
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_5_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 3
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_0_at_5_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 4
    i32.atomic.rmw8.sub_u offset=0
    drop)
  (func (export "sub_8_at_0_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_0_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 2
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_0_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 3
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_0_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 4
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_0_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 5
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_2_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 0
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_2_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 1
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_2_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 3
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_2_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 4
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_2_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 5
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_5_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 0
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_5_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 1
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_5_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 2
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_5_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 3
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_8_at_5_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 4
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "and_0_at_0_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_0_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 2
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_0_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 3
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_0_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 4
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_0_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 5
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_2_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 0
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_2_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 1
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_2_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 3
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_2_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 4
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_2_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 5
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_5_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 0
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_5_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 1
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_5_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 2
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_5_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 3
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_0_at_5_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 4
    i32.atomic.rmw8.and_u offset=0
    drop)
  (func (export "and_8_at_0_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_0_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 2
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_0_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 3
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_0_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 4
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_0_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 5
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_2_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 0
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_2_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 1
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_2_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 3
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_2_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 4
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_2_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 5
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_5_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 0
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_5_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 1
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_5_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 2
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_5_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 3
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_8_at_5_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 4
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "or_0_at_0_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_0_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 2
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_0_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 3
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_0_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 4
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_0_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 5
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_2_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 0
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_2_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 1
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_2_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 3
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_2_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 4
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_2_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 5
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_5_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 0
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_5_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 1
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_5_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 2
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_5_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 3
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_0_at_5_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 4
    i32.atomic.rmw8.or_u offset=0
    drop)
  (func (export "or_8_at_0_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_0_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 2
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_0_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 3
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_0_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 4
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_0_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 5
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_2_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 0
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_2_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 1
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_2_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 3
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_2_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 4
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_2_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 5
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_5_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 0
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_5_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 1
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_5_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 2
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_5_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 3
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_8_at_5_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 4
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "xor_0_at_0_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_0_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 2
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_0_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 3
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_0_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 4
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_0_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 5
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_2_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 0
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_2_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 1
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_2_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 3
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_2_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 4
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_2_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 5
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_5_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 0
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_5_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 1
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_5_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 2
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_5_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 3
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_0_at_5_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 4
    i32.atomic.rmw8.xor_u offset=0
    drop)
  (func (export "xor_8_at_0_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_0_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 2
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_0_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 3
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_0_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 4
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_0_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 5
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_2_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 0
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_2_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 1
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_2_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 3
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_2_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 4
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_2_by_5") (param i32 i32 i32 i32 i32 i32)
    local.get 2
    local.get 5
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_5_by_0") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 0
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_5_by_1") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 1
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_5_by_2") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 2
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_5_by_3") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 3
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_8_at_5_by_4") (param i32 i32 i32 i32 i32 i32)
    local.get 5
    local.get 4
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "wide_sub_by_1") (param i32 i64 i64 i64 i64 i64)
    local.get 0
    local.get 1
    i64.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "wide_sub_by_2") (param i32 i64 i64 i64 i64 i64)
    local.get 0
    local.get 2
    i64.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "wide_sub_by_3") (param i32 i64 i64 i64 i64 i64)
    local.get 0
    local.get 3
    i64.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "wide_sub_by_4") (param i32 i64 i64 i64 i64 i64)
    local.get 0
    local.get 4
    i64.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "wide_sub_by_5") (param i32 i64 i64 i64 i64 i64)
    local.get 0
    local.get 5
    i64.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "wide_xor_by_1") (param i32 i64 i64 i64 i64 i64)
    local.get 0
    local.get 1
    i64.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "wide_xor_by_2") (param i32 i64 i64 i64 i64 i64)
    local.get 0
    local.get 2
    i64.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "wide_xor_by_3") (param i32 i64 i64 i64 i64 i64)
    local.get 0
    local.get 3
    i64.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "wide_xor_by_4") (param i32 i64 i64 i64 i64 i64)
    local.get 0
    local.get 4
    i64.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "wide_xor_by_5") (param i32 i64 i64 i64 i64 i64)
    local.get 0
    local.get 5
    i64.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "add_constant_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 1
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_constant_minus_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const -1
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_constant_0x80") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x80
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_constant_0x1ff") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x1ff
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "add_constant_0x12345678") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x12345678
    i32.atomic.rmw8.add_u offset=8
    drop)
  (func (export "sub_constant_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 1
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_constant_minus_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const -1
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_constant_0x80") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x80
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_constant_0x1ff") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x1ff
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "sub_constant_0x12345678") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x12345678
    i32.atomic.rmw8.sub_u offset=8
    drop)
  (func (export "and_constant_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 1
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_constant_minus_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const -1
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_constant_0x80") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x80
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_constant_0x1ff") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x1ff
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "and_constant_0x12345678") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x12345678
    i32.atomic.rmw8.and_u offset=8
    drop)
  (func (export "or_constant_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 1
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_constant_minus_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const -1
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_constant_0x80") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x80
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_constant_0x1ff") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x1ff
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "or_constant_0x12345678") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x12345678
    i32.atomic.rmw8.or_u offset=8
    drop)
  (func (export "xor_constant_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 1
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_constant_minus_1") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const -1
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_constant_0x80") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x80
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_constant_0x1ff") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x1ff
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "xor_constant_0x12345678") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    i32.const 0x12345678
    i32.atomic.rmw8.xor_u offset=8
    drop)
  (func (export "half_sub") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw16.sub_u offset=8
    drop)
  (func (export "half_and") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw16.and_u offset=8
    drop)
  (func (export "half_or") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw16.or_u offset=8
    drop)
  (func (export "half_xor") (param i32 i32 i32 i32 i32 i32)
    local.get 0
    local.get 1
    i32.atomic.rmw16.xor_u offset=8
    drop)
)
