// Each value goes in as an argument in a register and on the stack, and as what an import returns.
var types = `
  (type $open (sub (struct (field i32))))
  (type $closed (sub final $open (struct (field i32))))
  (type $unary (func (param i32)))`;
var made = load(
  `${types}
   (func (export "open") (result anyref) (struct.new_default $open))
   (func (export "closed") (result anyref) (struct.new_default $closed))
   (func (export "unary") (type $unary))
   (func (export "nullary"))`,
);
var [open, closed, object] = [made.open(), made.closed(), {}];
var wrong = Symbol("wrong");
var numbers = [0, -1, 2 ** 31, -(2 ** 31), 2 ** 32 + 5, 2 ** 53, 1e300, 0.1, -0, NaN, -Infinity];
var convertible = [...numbers, true, false, null, undefined, "12", [3], { valueOf: () => 4.5 }];
var refused = values => values.map(value => [value, wrong]);
var kept = values => values.map(value => [value, value]);
var small = [0, -5, 2 ** 30 - 1, -(2 ** 30), 6 / 3];
var notEq = [2 ** 30, -(2 ** 30) - 1, 0.5, -0, object, "text", undefined, true, 1n, made.unary];

var cases = {
  i32: [...convertible.map(value => [value, value | 0]), ...refused([1n, wrong])],
  f32: [...convertible.map(value => [value, Math.fround(value)]), ...refused([1n])],
  f64: [...convertible.map(value => [value, +value]), ...refused([1n])],
  i64: [
    ...[0n, 1n, -1n, 2n ** 63n, -(2n ** 63n), 2n ** 64n + 7n, -(2n ** 70n) - 1n, true, "9"].map(value => [
      value,
      BigInt.asIntN(64, value),
    ]),
    ...refused([1, null, undefined]),
  ],
  externref: kept([null, undefined, object, 1.5, 2 ** 31, "text", open]),
  "(ref extern)": [...kept([undefined, object, 1]), ...refused([null])],
  anyref: kept([null, open, ...small, ...notEq]),
  "(ref any)": [...kept([open, ...small, ...notEq]), ...refused([null])],
  eqref: [...kept([null, open, ...small]), ...refused(notEq)],
  "(ref i31)": [...kept(small), ...refused([null, open, ...notEq])],
  structref: [...kept([null, open, closed]), ...refused([1, object])],
  funcref: [...kept([null, made.unary, made.nullary]), ...refused([() => {}, Math.abs, open, undefined, 1])],
  "(ref $unary)": [...kept([made.unary]), ...refused([null, made.nullary, () => {}])],
  "(ref $open)": [...kept([open, closed]), ...refused([null, 1, ...notEq])],
  "(ref null $closed)": [...kept([null, closed]), ...refused([open, 1, ...notEq])],
  "(ref null none)": [...kept([null]), ...refused([open, 1, undefined])],
};

for (var [type, pairs] of Object.entries(cases)) {
  var value, seen;
  var padding = "i32 f64 ".repeat(8);
  var wasm = load(
    `${types}
     (import "host" "give" (func $give (result ${type})))
     (import "host" "take" (func $take (param ${type} ${padding} ${type})))
     (func (export "first") (param ${type}) (result ${type}) (local.get 0))
     (func (export "last") (param ${padding} ${type}) (result ${type}) (local.get 16))
     (func (export "pair") (param ${type}) (result ${type} ${type}) (local.get 0) (local.get 0))
     (func (export "given") (result ${type}) (call $give))
     (func (export "taken") (param ${type})
       (call $take (local.get 0) ${"(i32.const -1) (f64.const 0.5) ".repeat(8)} (local.get 0)))`,
    { give: () => value, take: (...all) => (seen = all) },
  );
  var ways = [
    () => wasm.first(value),
    () => wasm.last(...Array(16).fill(0), value),
    () => wasm.pair(value)[1],
    () => wasm.given(),
    () => (wasm.taken(value), assertEq(seen.slice(1, 3).join(), "-1,0.5"), assertEq(seen[0], seen[17]), seen[0]),
  ];
  for (var round = 0; round < 2; round++) {
    for (var [value, expected] of pairs) {
      for (var way of ways) {
        if (expected === wrong) assertThrows(TypeError, way, type);
        else assertEq(way(), expected, type);
      }
      if (value === undefined && expected !== wrong) assertDeepEq([wasm.first(), wasm.last(1)], [expected, expected]);
    }
  }
}
