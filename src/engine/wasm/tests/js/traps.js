var wasm = load(
  `(import "host" "call" (func $call))
   (memory 1)
   (memory $checked 1)
   (table 2 funcref)
   (func $unreachable (export "unreachable") unreachable)
   (func (export "nested") (call $unreachable))
   (func (export "load") (param i32) (result i32) (i32.load (local.get 0)))
   (func (export "fill") (memory.fill (i32.const 65530) (i32.const 0) (i32.const 7)))
   (func (export "divide") (param i32 i32) (result i32) (i32.div_s (local.get 0) (local.get 1)))
   (func (export "truncate") (param f64) (result i32) (i32.trunc_f64_s (local.get 0)))
   (func (export "indirect") (param i32) (call_indirect (local.get 0)))
   (func $recurse (export "recurse") (call $recurse))
   (func (export "call") (call $call))
   (func (export "atomic") (param i32) (result i32) (i32.atomic.load $checked (local.get 0)))
   (func (export "guarded") (param i32) (result i32)
     try (result i32)
       (if (local.get 0) (then (call $recurse)) (else (call $unreachable)))
       (i32.const 0)
     catch_all
       (i32.const 1)
     end)`,
  {
    call: function called() {
      throw new Error("called");
    },
  },
);

function assertTraps(message, body) {
  var error = assertThrows(WebAssembly.RuntimeError, body);
  assertEq(error.message.slice(0, message.length), message);
}

function frames(error) {
  return error.stack.split("\n").map(line => line.replace(/@.*\.js:.*/, ""));
}

for (var round = 0; round < 3; round++) {
  assertTraps("Unreachable code should not be executed", () => wasm.unreachable());
  assertTraps("Out of bounds memory access", () => wasm.load(65533));
  assertTraps("Out of bounds memory access", () => wasm.load(-1));
  assertTraps("Out of bounds memory access", () => wasm.fill());
  assertTraps("Unaligned memory access", () => wasm.atomic(1));
  assertTraps("Out of bounds memory access", () => wasm.atomic(65537));
  assertTraps("Division by zero", () => wasm.divide(1, 0));
  assertTraps("Integer overflow", () => wasm.divide(1 << 31, -1));
  assertTraps("Out of bounds Trunc operation", () => wasm.truncate(NaN));
  assertTraps("call_indirect to a signature that does not match", () => wasm.indirect(1));
  assertTraps("Out of bounds call_indirect", () => wasm.indirect(2));
  assertThrows(RangeError, wasm.recurse);
  assertThrows(WebAssembly.RuntimeError, () => wasm.guarded(0));
  assertThrows(RangeError, () => wasm.guarded(1));
  assertEq(wasm.load(65532), 0);

  var error = assertThrows(WebAssembly.RuntimeError, function outer() {
    wasm.nested();
  });
  assertDeepEq(frames(error).slice(0, 3), ["1@wasm-function[1]", "2@wasm-function[2]", "outer"]);
  error = assertThrows(Error, function outer() {
    wasm.call();
  });
  assertDeepEq(frames(error).slice(0, 3), ["called", "9@wasm-function[9]", "outer"]);
  collect(round);
}
