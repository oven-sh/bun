;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: memory64.
(module
  (memory (export "memory") i64 1 2)
  (func (export "store") (param i64 i32) (i32.store (local.get 0) (local.get 1)))
  (func (export "load") (param i64) (result i32) (i32.load (local.get 0)))
  (func (export "loadFar") (param i64) (result i32) (i32.load offset=65532 (local.get 0)))
  (func (export "size") (result i64) (memory.size))
  (func (export "grow") (param i64) (result i64) (memory.grow (local.get 0)))
)
