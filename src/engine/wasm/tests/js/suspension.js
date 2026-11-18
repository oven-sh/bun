var pending = [];
var tag = new WebAssembly.Tag({ parameters: [] });
var imports = {
  wait: new WebAssembly.Suspending(value => new Promise((resolve, reject) => pending.push({ value, resolve, reject }))),
  many: new WebAssembly.Suspending(async () => [1, 2n, 3.5, "four", 5]),
  script: callback => callback(),
  memory: new WebAssembly.Memory({ initial: 1 }),
};
var wasm = load(
  `(type $box (struct (field i32)))
   (import "host" "wait" (func $wait (param i32) (result i32)))
   (import "host" "many" (func $many (result i32 i64 f64 externref i32)))
   (import "host" "script" (func $script (param externref) (result i32)))
   (import "host" "memory" (memory 1))
   (export "wait" (func $wait))
   (func $nested (export "nested") (param $depth i32) (result i32) (local $box (ref null $box))
     (if (i32.eqz (local.get $depth)) (then (return (i32.add (call $wait (i32.const 1)) (call $wait (i32.const 2))))))
     (local.set $box (struct.new $box (local.get $depth)))
     (i32.add (call $nested (i32.sub (local.get $depth) (i32.const 1))) (struct.get $box 0 (local.get $box))))
   (func (export "guarded") (result i32)
     try (result i32) (call $wait (i32.const 3)) catch_all (i32.add (call $wait (i32.const 4)) (memory.size)) end)
   (func (export "last") (result i32 i64 f64 externref i32) (return_call $many))
   (func (export "script") (param externref) (result i32) (call $script (local.get 0)))`,
  imports,
);
var [nested, guarded, last, script, wait] = ["nested", "guarded", "last", "script", "wait"].map(name =>
  WebAssembly.promising(wasm[name]),
);

async function settle(how, value) {
  while (!pending.length) await undefined;
  collect(true);
  pending.shift()[how](value);
}

function deeper(depth, body) {
  return depth ? [deeper(depth - 1, body)][0] : body();
}

runAsync(async () => {
  var first = deeper(50, () => nested(100)),
    second = nested(3);
  assertDeepEq(pending.map(it => it.value), [1, 1]);
  for (var value of [10, 20, { valueOf: () => 30 }, 40]) await settle("resolve", value);
  assertDeepEq([await first, await second], [5050 + 40, 6 + 60]);

  var result = guarded();
  imports.memory.grow(2);
  await settle("reject", "reason");
  await settle("resolve", 7);
  assertEq(await result, 10);

  result = nested(2);
  await settle("reject", tag);
  assertEq(await result.catch(reason => reason), tag);
  result = nested(2);
  await settle("resolve", 1n);
  assert((await result.catch(reason => reason)) instanceof TypeError);

  assertEq((await last()).join(), "1,2,3.5,four,5");
  assertEq(await script(() => 8), 8);

  assertThrows(WebAssembly.SuspendError, () => wasm.nested(0));
  assertThrows(WebAssembly.SuspendError, () => wasm.wait(0));
  for (var refused of [script(() => wasm.nested(0)), wait(0)]) {
    assert((await refused.catch(reason => reason)) instanceof WebAssembly.SuspendError);
  }
  assertEq(pending.length, 0);

  var inner;
  assertEq(await script(() => ((inner = nested(0)), 9)), 9);
  await settle("resolve", 1);
  await settle("resolve", 2);
  assertEq(await inner, 3);
});

assertThrows(TypeError, () => new WebAssembly.Suspending({}));
assertThrows(TypeError, () => WebAssembly.promising(() => {}));
