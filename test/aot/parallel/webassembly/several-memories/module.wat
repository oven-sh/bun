;; Source of the .wasm file of the same name. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: multi-memory, bulk-memory.
(module
  (memory $a (export "a") 1 2)
  (memory $b (export "b") 1 3)
  (data (memory $b) (i32.const 8) "\2a")
  (func (export "move") (param i32 i32) (i32.store $b (local.get 1) (i32.load $a (local.get 0))))
  (func (export "readA") (param i32) (result i32) (i32.load $a (local.get 0)))
  (func (export "readB") (param i32) (result i32) (i32.load $b (local.get 0)))
  (func (export "sizes") (result i32) (i32.add (memory.size $a) (i32.mul (memory.size $b) (i32.const 10))))
  (func (export "growA") (param i32) (result i32) (memory.grow $a (local.get 0)))
  (func (export "growB") (param i32) (result i32) (memory.grow $b (local.get 0)))
  (func (export "copyAToB") (param i32 i32 i32) (memory.copy $b $a (local.get 0) (local.get 1) (local.get 2)))
  (func (export "fillB") (param i32 i32 i32) (memory.fill $b (local.get 0) (local.get 1) (local.get 2)))
)
