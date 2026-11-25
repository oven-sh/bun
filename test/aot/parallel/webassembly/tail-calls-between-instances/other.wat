;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: none.
(module
  (memory 1)
  (data (i32.const 0) "\2a")
  (func (export "peek") (param i32) (result i32) (i32.load8_u (local.get 0)))
)
