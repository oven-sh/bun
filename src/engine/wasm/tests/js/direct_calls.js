var other = load(
  `(memory 1)
   (data (i32.const 0) "\\09")
   (func (export "read") (result i32) (i32.load (i32.const 0)))`,
);
var host;
var mixed = "i32 f64 i64 f32 externref ".repeat(5);
var wasm = load(
  `(import "host" "call" (func $host))
   (import "host" "wait" (func $wait (result i32)))
   (import "host" "read" (func $read (result i32)))
   (memory (export "memory") 1)
   (data (i32.const 0) "\\05")
   (tag $tag (export "tag"))
   (export "imported" (func $read))
   ${["i32", "i64", "f32", "f64", "externref", "(ref extern)"]
     .map((type, index) => `(func (export "same${index}") (param ${type}) (result ${type}) (call $host) (local.get 0))`)
     .join("\n")}
   ${[...Array(25).keys()]
     .map(index => `(func (export "pick${index}") (param ${mixed}) (result ${mixed.split(" ")[index]}) (local.get ${index}))`)
     .join("\n")}
   (func $many (param ${"i32 ".repeat(12)}) (result i32)
     (i32.add (i32.sub (local.get 11) (local.get 0)) (i32.load (i32.const 0))))
   (func (export "last") (result i32) (return_call $many ${"(i32.const 3) ".repeat(12)}))
   (func $none (result i32) (i32.const 6))
   (func (export "fewer") (param ${"i32 ".repeat(12)}) (result i32) (return_call $none))
   (func (export "elsewhere") (result i32) (return_call $read))
   (func (export "both") (result i32) (i32.add (call $read) (i32.load (i32.const 0))))
   (func (export "nothing") (param i32))
   (func (export "small") (param i32) (result anyref) (ref.i31 (local.get 0)))
   (func (export "pair") (param i32) (result i32 i32) (local.get 0) (i32.const 2))
   (func (export "typed") (param funcref) (result i32) (ref.is_null (local.get 0)))
   (func (export "throw") (param i32) (result i32) (if (local.get 0) (then (throw $tag))) (i32.const 1))
   (func $trap (export "trap") (param i32) (result i32) (i32.div_u (i32.const 1) (local.get 0)))
   (func (export "grow") (param i32) (result i32) (memory.grow (local.get 0)))
   (func (export "wait") (param i32) (result i32) (if (result i32) (local.get 0) (then (call $wait)) (else (i32.const 1))))
   (func (export "around") (result i32) try (result i32) (call $host) (i32.const 7) catch $tag (i32.const 8) end)`,
  { call: () => host(), wait: new WebAssembly.Suspending(fail), read: other.read },
);

// A function that shares nothing with those of the same text, with `f` for the export.
var compiled = 0;
function compile(source, f) {
  return new Function("f", `return ${source} // ${compiled++}`)(f);
}

function warm(source, f, ...args) {
  var caller = compile(source, f);
  for (var turn = 0; turn < 60; turn++) caller(...args);
  return caller;
}

function outcome(f, args) {
  try {
    return f(...args);
  } catch (error) {
    return String(error);
  }
}

// A caller that is used to one list of arguments, or to all but one, does what one does that has never run.
function check(source, f, lists) {
  var expected = lists.map(args => outcome(compile(source, f), args));
  for (var usual of lists.flatMap(one => [[one], lists.filter(it => it != one)])) {
    var caller = compile(source, f);
    for (var turn = 0; turn < 60; turn++) usual.forEach(args => outcome(caller, args));
    lists.forEach((args, index) => assertEq(outcome(caller, args), expected[index], `${source} ${show(usual)}`));
  }
}

var values = [0, -0, 7, -1, 2 ** 31, 2 ** 53, 0.1, NaN, -Infinity, true, undefined, null, "7", 0n, -3n, 2n ** 64n + 1n];
values.push(Symbol(), { valueOf: () => 2 });
host = () => {};
for (var index = 0; index < 6; index++) {
  check("a => f(a)", wasm["same" + index], values.map(value => [value]));
  check("() => f()", wasm["same" + index], [[]]);
}
var row = start => [...Array(5).keys()].flatMap(it => [start + it, it + 0.5, BigInt(start - it), it + 0.25, "" + it]);
var names = row(0).map((_, index) => "a" + index);
for (var index = 0; index < 25; index++) check(`(${names}) => f(${names})`, wasm["pick" + index], [row(1), row(-9)]);
for (var name of ["last", "elsewhere", "both", "imported", "nothing", "small", "typed"])
  check("(a, b) => [f(a, b), a, b].join()", wasm[name], [[1, 0.5], [null, "x"]]);
check("a => f(a).join()", wasm.pair, [[1], ["2"]]);
var constructing = compile("() => new f(1)", wasm.nothing);
for (var turn = 0; turn < 500; turn++) assertThrows(TypeError, constructing);
var sums = "var x = a * 3, y = a * 5, z = a * 7; for (var i = 0; i < a; i++) (x += f(i)), (y ^= x), (z += y & 1);";
for (var [name, model] of Object.entries({ same0: i => i, last: () => 5, fewer: () => 6 }))
  assertEq(...[wasm[name], model].map(f => warm(`a => { ${sums} return x + y + z; }`, f, 9)(40000)));

var catching = "(a, b) => { var kept = [b * 1.5, {}]; try { return f(a); } catch (e) { return [e, b + 1, kept[0]]; } }";
var caught = warm(catching, wasm.throw, 0, 1)(1, 2);
assert(caught[0].is(wasm.tag));
assertDeepEq(caught.slice(1), [3, 3]);
caught = warm(catching, wasm.trap, 1, 1)(0, 2);
assert(caught[0] instanceof WebAssembly.RuntimeError);
var passing = warm(catching, wasm.same0, 1, 1);
host = () => {
  collect(true);
  throw 4;
};
assertDeepEq(passing(1, 2), [4, 3, 3]);

var functionsIn = error => error.stack.split("\n").map(line => line.split("@")[0]).filter(it => it != "wasm-stub");
for (var strict of ["", "'use strict';"]) {
  var source = `function outer(a) { ${strict} function inner() { return f(a); } return inner() + 1; }`;
  var stackOf = caller => functionsIn(assertThrows(WebAssembly.RuntimeError, () => void caller(0))).slice(0, 3);
  assertDeepEq(stackOf(warm(source, wasm.trap, 1)), stackOf(compile(source, wasm.trap)));
}

// What the caller has relied on changes during the call.
[5, 5n, 0.5, 0.1, "s", "s"].forEach((value, index) => {
  var Point = class {};
  Point.prototype.x = 1;
  host = () => {};
  var caller = warm("(a, point) => [point.x, f(a), point.x]", wasm["same" + index], value, new Point());
  host = () => {
    Point.prototype.x = 2;
    collect(true);
  };
  assertEq(show(caller(value, new Point())), show([1, value, 2]));
});

host = () => collect(false);
assertEq(warm("a => f({ a }).a", wasm.same4, 1)(2), 2);

var lengths = "(a, view) => [view.length, f(a), view.length]";
var view = new Uint8Array(wasm.memory.buffer);
assertDeepEq(warm(lengths, wasm.grow, 1 << 20, view)(1, view), [65536, 1, 0]);

host = () => {};
var endless = warm("() => f(1) + 1", wasm.same0);
host = endless;
assertThrows(RangeError, endless);

var throwing = warm("a => f(a)", wasm.throw, 0);
host = () => throwing(1);
assertEq(wasm.around(), 8);
var waiting = warm("a => f(a)", wasm.wait, 0);
host = () => waiting(1);
runAsync(async () => {
  var refused = WebAssembly.promising(wasm.around)();
  assert((await refused.catch(reason => reason)) instanceof WebAssembly.SuspendError);
});
