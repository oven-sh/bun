;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  (memory (export "memory") 1)

  (func (export "if32_0_1") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 1 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_0_1") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 1 i32.and i32.eqz)
  (func (export "select32_0_1") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 0 i32.load offset=0 i32.const 1 i32.and select)
  (func (export "if32_0_80") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 128 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_0_80") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 128 i32.and i32.eqz)
  (func (export "select32_0_80") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 0 i32.load offset=0 i32.const 128 i32.and select)
  (func (export "if32_0_ff00") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 65280 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_0_ff00") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 65280 i32.and i32.eqz)
  (func (export "select32_0_ff00") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 0 i32.load offset=0 i32.const 65280 i32.and select)
  (func (export "if32_0_10000") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 65536 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_0_10000") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 65536 i32.and i32.eqz)
  (func (export "select32_0_10000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 0 i32.load offset=0 i32.const 65536 i32.and select)
  (func (export "if32_0_40000000") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 1073741824 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_0_40000000") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 1073741824 i32.and i32.eqz)
  (func (export "select32_0_40000000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 0 i32.load offset=0 i32.const 1073741824 i32.and select)
  (func (export "if32_0_80000000") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const -2147483648 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_0_80000000") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const -2147483648 i32.and i32.eqz)
  (func (export "select32_0_80000000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 0 i32.load offset=0 i32.const -2147483648 i32.and select)
  (func (export "if32_0_101") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 257 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_0_101") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const 257 i32.and i32.eqz)
  (func (export "select32_0_101") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 0 i32.load offset=0 i32.const 257 i32.and select)
  (func (export "if32_0_ffffffff") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const -1 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_0_ffffffff") (param $p i32) (result i32)
    i32.const 0 i32.load offset=0 i32.const -1 i32.and i32.eqz)
  (func (export "select32_0_ffffffff") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 0 i32.load offset=0 i32.const -1 i32.and select)
  (func (export "if64_0_1") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 1 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_0_1") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 1 i64.and i64.const 0 i64.ne)
  (func (export "if64_0_80") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 128 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_0_80") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 128 i64.and i64.const 0 i64.ne)
  (func (export "if64_0_ff00") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 65280 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_0_ff00") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 65280 i64.and i64.const 0 i64.ne)
  (func (export "if64_0_10000") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 65536 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_0_10000") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 65536 i64.and i64.const 0 i64.ne)
  (func (export "if64_0_40000000") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 1073741824 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_0_40000000") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 1073741824 i64.and i64.const 0 i64.ne)
  (func (export "if64_0_80000000") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 2147483648 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_0_80000000") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 2147483648 i64.and i64.const 0 i64.ne)
  (func (export "if64_0_101") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 257 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_0_101") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 257 i64.and i64.const 0 i64.ne)
  (func (export "if64_0_ffffffff") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 4294967295 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_0_ffffffff") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 4294967295 i64.and i64.const 0 i64.ne)
  (func (export "if64_0_100000000") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 4294967296 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_0_100000000") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const 4294967296 i64.and i64.const 0 i64.ne)
  (func (export "if64_0_8000000000000000") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const -9223372036854775808 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_0_8000000000000000") (param $p i32) (result i32)
    i32.const 0 i64.load offset=0 i64.const -9223372036854775808 i64.and i64.const 0 i64.ne)
  (func (export "variable_0") (param $p i32) (result i32)
    local.get $p i32.load offset=0 i32.const 4 i32.and
    if (result i32)
      i32.const 1
    else
      i32.const 2
    end)
  (func (export "if32_65529_1") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 1 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65529_1") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 1 i32.and i32.eqz)
  (func (export "select32_65529_1") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65529 i32.load offset=0 i32.const 1 i32.and select)
  (func (export "if32_65529_80") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 128 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65529_80") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 128 i32.and i32.eqz)
  (func (export "select32_65529_80") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65529 i32.load offset=0 i32.const 128 i32.and select)
  (func (export "if32_65529_ff00") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 65280 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65529_ff00") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 65280 i32.and i32.eqz)
  (func (export "select32_65529_ff00") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65529 i32.load offset=0 i32.const 65280 i32.and select)
  (func (export "if32_65529_10000") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 65536 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65529_10000") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 65536 i32.and i32.eqz)
  (func (export "select32_65529_10000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65529 i32.load offset=0 i32.const 65536 i32.and select)
  (func (export "if32_65529_40000000") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 1073741824 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65529_40000000") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 1073741824 i32.and i32.eqz)
  (func (export "select32_65529_40000000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65529 i32.load offset=0 i32.const 1073741824 i32.and select)
  (func (export "if32_65529_80000000") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const -2147483648 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65529_80000000") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const -2147483648 i32.and i32.eqz)
  (func (export "select32_65529_80000000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65529 i32.load offset=0 i32.const -2147483648 i32.and select)
  (func (export "if32_65529_101") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 257 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65529_101") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const 257 i32.and i32.eqz)
  (func (export "select32_65529_101") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65529 i32.load offset=0 i32.const 257 i32.and select)
  (func (export "if32_65529_ffffffff") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const -1 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65529_ffffffff") (param $p i32) (result i32)
    i32.const 65529 i32.load offset=0 i32.const -1 i32.and i32.eqz)
  (func (export "select32_65529_ffffffff") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65529 i32.load offset=0 i32.const -1 i32.and select)
  (func (export "if64_65529_1") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 1 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65529_1") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 1 i64.and i64.const 0 i64.ne)
  (func (export "if64_65529_80") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 128 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65529_80") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 128 i64.and i64.const 0 i64.ne)
  (func (export "if64_65529_ff00") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 65280 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65529_ff00") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 65280 i64.and i64.const 0 i64.ne)
  (func (export "if64_65529_10000") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 65536 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65529_10000") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 65536 i64.and i64.const 0 i64.ne)
  (func (export "if64_65529_40000000") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 1073741824 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65529_40000000") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 1073741824 i64.and i64.const 0 i64.ne)
  (func (export "if64_65529_80000000") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 2147483648 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65529_80000000") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 2147483648 i64.and i64.const 0 i64.ne)
  (func (export "if64_65529_101") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 257 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65529_101") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 257 i64.and i64.const 0 i64.ne)
  (func (export "if64_65529_ffffffff") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 4294967295 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65529_ffffffff") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 4294967295 i64.and i64.const 0 i64.ne)
  (func (export "if64_65529_100000000") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 4294967296 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65529_100000000") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const 4294967296 i64.and i64.const 0 i64.ne)
  (func (export "if64_65529_8000000000000000") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const -9223372036854775808 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65529_8000000000000000") (param $p i32) (result i32)
    i32.const 65529 i64.load offset=0 i64.const -9223372036854775808 i64.and i64.const 0 i64.ne)
  (func (export "variable_65529") (param $p i32) (result i32)
    local.get $p i32.load offset=65529 i32.const 4 i32.and
    if (result i32)
      i32.const 1
    else
      i32.const 2
    end)
  (func (export "if32_65532_1") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 1 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65532_1") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 1 i32.and i32.eqz)
  (func (export "select32_65532_1") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65532 i32.load offset=0 i32.const 1 i32.and select)
  (func (export "if32_65532_80") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 128 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65532_80") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 128 i32.and i32.eqz)
  (func (export "select32_65532_80") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65532 i32.load offset=0 i32.const 128 i32.and select)
  (func (export "if32_65532_ff00") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 65280 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65532_ff00") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 65280 i32.and i32.eqz)
  (func (export "select32_65532_ff00") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65532 i32.load offset=0 i32.const 65280 i32.and select)
  (func (export "if32_65532_10000") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 65536 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65532_10000") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 65536 i32.and i32.eqz)
  (func (export "select32_65532_10000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65532 i32.load offset=0 i32.const 65536 i32.and select)
  (func (export "if32_65532_40000000") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 1073741824 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65532_40000000") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 1073741824 i32.and i32.eqz)
  (func (export "select32_65532_40000000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65532 i32.load offset=0 i32.const 1073741824 i32.and select)
  (func (export "if32_65532_80000000") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const -2147483648 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65532_80000000") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const -2147483648 i32.and i32.eqz)
  (func (export "select32_65532_80000000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65532 i32.load offset=0 i32.const -2147483648 i32.and select)
  (func (export "if32_65532_101") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 257 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65532_101") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const 257 i32.and i32.eqz)
  (func (export "select32_65532_101") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65532 i32.load offset=0 i32.const 257 i32.and select)
  (func (export "if32_65532_ffffffff") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const -1 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65532_ffffffff") (param $p i32) (result i32)
    i32.const 65532 i32.load offset=0 i32.const -1 i32.and i32.eqz)
  (func (export "select32_65532_ffffffff") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65532 i32.load offset=0 i32.const -1 i32.and select)
  (func (export "if64_65532_1") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 1 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65532_1") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 1 i64.and i64.const 0 i64.ne)
  (func (export "if64_65532_80") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 128 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65532_80") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 128 i64.and i64.const 0 i64.ne)
  (func (export "if64_65532_ff00") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 65280 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65532_ff00") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 65280 i64.and i64.const 0 i64.ne)
  (func (export "if64_65532_10000") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 65536 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65532_10000") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 65536 i64.and i64.const 0 i64.ne)
  (func (export "if64_65532_40000000") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 1073741824 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65532_40000000") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 1073741824 i64.and i64.const 0 i64.ne)
  (func (export "if64_65532_80000000") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 2147483648 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65532_80000000") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 2147483648 i64.and i64.const 0 i64.ne)
  (func (export "if64_65532_101") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 257 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65532_101") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 257 i64.and i64.const 0 i64.ne)
  (func (export "if64_65532_ffffffff") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 4294967295 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65532_ffffffff") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 4294967295 i64.and i64.const 0 i64.ne)
  (func (export "if64_65532_100000000") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 4294967296 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65532_100000000") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const 4294967296 i64.and i64.const 0 i64.ne)
  (func (export "if64_65532_8000000000000000") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const -9223372036854775808 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65532_8000000000000000") (param $p i32) (result i32)
    i32.const 65532 i64.load offset=0 i64.const -9223372036854775808 i64.and i64.const 0 i64.ne)
  (func (export "variable_65532") (param $p i32) (result i32)
    local.get $p i32.load offset=65532 i32.const 4 i32.and
    if (result i32)
      i32.const 1
    else
      i32.const 2
    end)
  (func (export "if32_65533_1") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 1 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65533_1") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 1 i32.and i32.eqz)
  (func (export "select32_65533_1") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65533 i32.load offset=0 i32.const 1 i32.and select)
  (func (export "if32_65533_80") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 128 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65533_80") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 128 i32.and i32.eqz)
  (func (export "select32_65533_80") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65533 i32.load offset=0 i32.const 128 i32.and select)
  (func (export "if32_65533_ff00") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 65280 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65533_ff00") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 65280 i32.and i32.eqz)
  (func (export "select32_65533_ff00") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65533 i32.load offset=0 i32.const 65280 i32.and select)
  (func (export "if32_65533_10000") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 65536 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65533_10000") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 65536 i32.and i32.eqz)
  (func (export "select32_65533_10000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65533 i32.load offset=0 i32.const 65536 i32.and select)
  (func (export "if32_65533_40000000") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 1073741824 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65533_40000000") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 1073741824 i32.and i32.eqz)
  (func (export "select32_65533_40000000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65533 i32.load offset=0 i32.const 1073741824 i32.and select)
  (func (export "if32_65533_80000000") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const -2147483648 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65533_80000000") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const -2147483648 i32.and i32.eqz)
  (func (export "select32_65533_80000000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65533 i32.load offset=0 i32.const -2147483648 i32.and select)
  (func (export "if32_65533_101") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 257 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65533_101") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const 257 i32.and i32.eqz)
  (func (export "select32_65533_101") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65533 i32.load offset=0 i32.const 257 i32.and select)
  (func (export "if32_65533_ffffffff") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const -1 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65533_ffffffff") (param $p i32) (result i32)
    i32.const 65533 i32.load offset=0 i32.const -1 i32.and i32.eqz)
  (func (export "select32_65533_ffffffff") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65533 i32.load offset=0 i32.const -1 i32.and select)
  (func (export "if64_65533_1") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 1 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65533_1") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 1 i64.and i64.const 0 i64.ne)
  (func (export "if64_65533_80") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 128 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65533_80") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 128 i64.and i64.const 0 i64.ne)
  (func (export "if64_65533_ff00") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 65280 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65533_ff00") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 65280 i64.and i64.const 0 i64.ne)
  (func (export "if64_65533_10000") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 65536 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65533_10000") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 65536 i64.and i64.const 0 i64.ne)
  (func (export "if64_65533_40000000") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 1073741824 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65533_40000000") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 1073741824 i64.and i64.const 0 i64.ne)
  (func (export "if64_65533_80000000") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 2147483648 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65533_80000000") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 2147483648 i64.and i64.const 0 i64.ne)
  (func (export "if64_65533_101") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 257 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65533_101") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 257 i64.and i64.const 0 i64.ne)
  (func (export "if64_65533_ffffffff") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 4294967295 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65533_ffffffff") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 4294967295 i64.and i64.const 0 i64.ne)
  (func (export "if64_65533_100000000") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 4294967296 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65533_100000000") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const 4294967296 i64.and i64.const 0 i64.ne)
  (func (export "if64_65533_8000000000000000") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const -9223372036854775808 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65533_8000000000000000") (param $p i32) (result i32)
    i32.const 65533 i64.load offset=0 i64.const -9223372036854775808 i64.and i64.const 0 i64.ne)
  (func (export "variable_65533") (param $p i32) (result i32)
    local.get $p i32.load offset=65533 i32.const 4 i32.and
    if (result i32)
      i32.const 1
    else
      i32.const 2
    end)
  (func (export "if32_65535_1") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 1 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65535_1") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 1 i32.and i32.eqz)
  (func (export "select32_65535_1") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65535 i32.load offset=0 i32.const 1 i32.and select)
  (func (export "if32_65535_80") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 128 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65535_80") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 128 i32.and i32.eqz)
  (func (export "select32_65535_80") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65535 i32.load offset=0 i32.const 128 i32.and select)
  (func (export "if32_65535_ff00") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 65280 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65535_ff00") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 65280 i32.and i32.eqz)
  (func (export "select32_65535_ff00") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65535 i32.load offset=0 i32.const 65280 i32.and select)
  (func (export "if32_65535_10000") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 65536 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65535_10000") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 65536 i32.and i32.eqz)
  (func (export "select32_65535_10000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65535 i32.load offset=0 i32.const 65536 i32.and select)
  (func (export "if32_65535_40000000") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 1073741824 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65535_40000000") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 1073741824 i32.and i32.eqz)
  (func (export "select32_65535_40000000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65535 i32.load offset=0 i32.const 1073741824 i32.and select)
  (func (export "if32_65535_80000000") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const -2147483648 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65535_80000000") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const -2147483648 i32.and i32.eqz)
  (func (export "select32_65535_80000000") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65535 i32.load offset=0 i32.const -2147483648 i32.and select)
  (func (export "if32_65535_101") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 257 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65535_101") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const 257 i32.and i32.eqz)
  (func (export "select32_65535_101") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65535 i32.load offset=0 i32.const 257 i32.and select)
  (func (export "if32_65535_ffffffff") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const -1 i32.and
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is32_65535_ffffffff") (param $p i32) (result i32)
    i32.const 65535 i32.load offset=0 i32.const -1 i32.and i32.eqz)
  (func (export "select32_65535_ffffffff") (param $p i32) (result i32)
    local.get $p i32.const 7 i32.const 65535 i32.load offset=0 i32.const -1 i32.and select)
  (func (export "if64_65535_1") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 1 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65535_1") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 1 i64.and i64.const 0 i64.ne)
  (func (export "if64_65535_80") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 128 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65535_80") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 128 i64.and i64.const 0 i64.ne)
  (func (export "if64_65535_ff00") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 65280 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65535_ff00") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 65280 i64.and i64.const 0 i64.ne)
  (func (export "if64_65535_10000") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 65536 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65535_10000") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 65536 i64.and i64.const 0 i64.ne)
  (func (export "if64_65535_40000000") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 1073741824 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65535_40000000") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 1073741824 i64.and i64.const 0 i64.ne)
  (func (export "if64_65535_80000000") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 2147483648 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65535_80000000") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 2147483648 i64.and i64.const 0 i64.ne)
  (func (export "if64_65535_101") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 257 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65535_101") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 257 i64.and i64.const 0 i64.ne)
  (func (export "if64_65535_ffffffff") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 4294967295 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65535_ffffffff") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 4294967295 i64.and i64.const 0 i64.ne)
  (func (export "if64_65535_100000000") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 4294967296 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65535_100000000") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const 4294967296 i64.and i64.const 0 i64.ne)
  (func (export "if64_65535_8000000000000000") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const -9223372036854775808 i64.and i64.eqz
    if (result i32)
      i32.const 10
    else
      i32.const 20
    end)
  (func (export "is64_65535_8000000000000000") (param $p i32) (result i32)
    i32.const 65535 i64.load offset=0 i64.const -9223372036854775808 i64.and i64.const 0 i64.ne)
  (func (export "variable_65535") (param $p i32) (result i32)
    local.get $p i32.load offset=65535 i32.const 4 i32.and
    if (result i32)
      i32.const 1
    else
      i32.const 2
    end)
)
