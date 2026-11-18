var seen;
var first = load(
  `(import "host" "note" (func $note (param i32) (result i32)))
   (import "host" "pair" (func $pair (result i64 f32)))
   (import "host" "vector" (func $vector (param v128)))
   (memory 1)
   (data (i32.const 0) "\\2a")
   (table (export "table") 1 funcref)
   (elem (i32.const 0) func $read)
   (func $read (export "read") (export "alias") (result i32) (i32.load (i32.const 0)))
   (func (export "reference") (result funcref) (ref.func $read))
   (func (export "pair") (result f32 i64) (local i64 f32)
     (call $pair) (local.set 1) (local.set 0) (local.get 1) (local.get 0))
   (func (export "callVector") (call $vector (v128.const i64x2 0 0)))
   (export "note" (func $note))
   (export "vector" (func $vector))`,
  {
    note(value) {
      seen = [this, value];
      return "text";
    },
    pair: () => seen,
    vector: fail,
  },
);

assertEq(first.read, first.alias);
assertEq(first.read, first.table.get(0));
assertEq(first.read, first.reference());
assertDeepEq([first.read.name, first.read.length, first.note.name, first.note.length], ["3", 0, "", 1]);
assertThrows(TypeError, first.vector);
assertThrows(TypeError, first.callVector);

seen = new Set([-1n, 0.5]);
var pair = first.pair();
assertEq(pair[0], 0.5);
assertEq(pair[1], -1n);
for (seen of [[1n], [1n, 2, 3], 1, [1, 2]]) assertThrows(TypeError, first.pair);

var second = load(
  `(import "host" "read" (func $read (result i32)))
   (import "host" "note" (func $note (param i32) (result i32)))
   (memory 1)
   (data (i32.const 0) "\\07")
   (func (export "both") (result i32) (i32.add (call $read) (i32.load (i32.const 0))))
   (func (export "last") (result i32) (return_call $read))
   (func (export "callNote") (result i32) (call $note (i32.const 3)))
   (export "read" (func $read))
   (export "note" (func $note))`,
  first,
);
assertEq(second.read, first.read);
assertEq(second.note, first.note);
assertThrows(WebAssembly.LinkError, () => load(`(import "host" "read" (func (result i64)))`, first));

var { both, last, callNote } = second;
first = second = undefined;
collect(true);
assertDeepEq([both(), last(), callNote(), seen[1]], [49, 42, 0, 3]);
