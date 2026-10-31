;; Source of module.wasm. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  (type (;0;) (func (param i32 i32) (result i32)))
  (type (;1;) (func (param i32) (result i32)))
  (type (;2;) (func (result i32)))
  (import "env" "memory" (memory 0))
  (export "poke" (func $poke))
  (export "peek" (func $peek))
  (export "pages" (func $pages))
  (export "twice" (func $twice))

  ;; Stores the value, then returns the loaded value plus one.
  (func $poke (type 0)
    local.get 0
    local.get 1
    i32.store
    local.get 0
    i32.load
    i32.const 1
    i32.add)

  (func $peek (type 1)
    local.get 0
    i32.load)

  (func $pages (type 2)
    memory.size)

  (func $twice (type 1)
    local.get 0
    i32.const 1
    i32.shl)
)
