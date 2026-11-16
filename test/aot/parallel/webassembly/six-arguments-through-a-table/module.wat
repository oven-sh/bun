;; Source of module.wasm. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
;; The module has no memory, and six arguments are in registers where it calls through its table.
(module
  (type $six (func (param i32 i32 i32 i32 i32 i32) (result i32)))
  (type $seven (func (param i32 i32 i32 i32 i32 i32 i32) (result i32)))
  (table (export "table") 3 funcref)
  (elem (i32.const 0) $weighted)
  (func $weighted (export "weighted") (type $six)
    local.get 0
    local.get 1 i32.const 2 i32.mul i32.add
    local.get 2 i32.const 3 i32.mul i32.add
    local.get 3 i32.const 4 i32.mul i32.add
    local.get 4 i32.const 5 i32.mul i32.add
    local.get 5 i32.const 6 i32.mul i32.add)
  (func (export "indirect") (type $seven)
    local.get 0 local.get 1 local.get 2 local.get 3 local.get 4 local.get 5
    local.get 6
    call_indirect (type $six))
  (func (export "indirectTwice") (type $seven)
    local.get 0 local.get 1 local.get 2 local.get 3 local.get 4 local.get 5
    local.get 6
    call_indirect (type $six)
    local.get 5 local.get 4 local.get 3 local.get 2 local.get 1 local.get 0
    local.get 6
    call_indirect (type $six)
    i32.sub))
