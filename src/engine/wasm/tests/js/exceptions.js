var tag = new WebAssembly.Tag({ parameters: ["i32", "i64", "f32", "f64", "externref"] });
var other = new WebAssembly.Tag({ parameters: [] });
var object = {};
var made = new WebAssembly.Exception(tag, ["1", 2n, 0.5, 1.5, object], { traceStack: true });
assertDeepEq([made.is(tag), made.is(other), typeof made.stack], [true, false, "string"]);
[1, 2n, 0.5, 1.5, object].forEach((value, index) => assertEq(made.getArg(tag, index), value));
assertEq(new WebAssembly.Exception(other, []).stack, undefined);
assertThrows(RangeError, () => made.getArg(tag, 5));
assertThrows(TypeError, () => made.getArg(other, 0));
assertThrows(TypeError, () => new WebAssembly.Exception(tag, [1]));
assertThrows(TypeError, () => new WebAssembly.Exception(WebAssembly.JSTag, [1]));
assertThrows(TypeError, () => new WebAssembly.Tag({ parameters: ["i8"] }));
assertEq(WebAssembly.JSTag, WebAssembly.JSTag);

var thrown;
var imports = {
  tag,
  script: WebAssembly.JSTag,
  fail() {
    collect(false);
    throw thrown;
  },
};
var declarations = `
  (import "host" "fail" (func $fail))
  (import "host" "tag" (tag $tag (param i32 i64 f32 f64 externref)))
  (import "host" "script" (tag $script (param externref)))
  (tag $own (export "own") (param i32))
  (export "tag" (tag $tag))
  (func (export "throwOwn") (param i32) (throw $own (local.get 0)))
  (func (export "throwValue") (param externref) (throw $script (local.get 0)))`;

var legacy = load(
  `${declarations}
   (func (export "classify") (result i32)
     try (result i32)
       try (result i32) (call $fail) (i32.const 0) catch $own end
     catch $tag
       drop drop drop drop
     catch $script
       drop (i32.const -1)
     end)
   (func (export "value") (result externref) try (result externref) (call $fail) (ref.null extern) catch $script end)
   (func (export "again") try (call $fail) catch_all (rethrow 0) end)
   (func (export "delegated") (result i32)
     try $outer (result i32)
       try (result i32)
         try (result i32) (call $fail) (i32.const 0) delegate $outer
       catch_all (i32.const 1) end
     catch_all (i32.const 2) end)`,
  imports,
);

var modern = load(
  `${declarations}
   (func (export "classify") (result i32)
     (block $script (result externref)
       (block $tag (result i32 i64 f32 f64 externref)
         (block $own (result i32)
           (try_table (catch $tag $tag) (catch $script $script)
             (try_table (catch $own $own) (call $fail)))
           (i32.const 0))
         return)
       drop drop drop drop return)
     drop (i32.const -1))
   (func (export "value") (result externref) (try_table (catch $script 0) (call $fail)) (ref.null extern))
   (func (export "again") (block (result exnref) (try_table (catch_all_ref 0) (call $fail)) return) throw_ref)
   (func (export "reference") (result exnref) (ref.null exn))`,
  imports,
);

function caught(body) {
  try {
    body();
  } catch (error) {
    return error;
  }
  fail("nothing was thrown");
}

for (var wasm of [legacy, modern]) {
  assertEq(wasm.tag, tag);
  var own = caught(() => wasm.throwOwn(7));
  assertEq(own.getArg(wasm.own, 0), 7);
  for (var [value, expected] of [[own, 7], [made, 1], [new Error(), -1], [null, -1], [undefined, -1], [5, -1]]) {
    thrown = value;
    assertEq(wasm.classify(), expected);
    assertEq(caught(wasm.again), value);
    if (expected === -1) {
      assertEq(wasm.value(), value);
      assertEq(caught(() => wasm.throwValue(value)), value);
    }
  }
  thrown = new WebAssembly.Exception(other, []);
  assertEq(caught(wasm.classify), thrown);
}
assertEq(legacy.delegated(), 2);
assertThrows(TypeError, modern.reference);
assertThrows(WebAssembly.LinkError, () => load(declarations, { ...imports, tag: other }));

// What WebAssembly throws with the tag of scripts keeps that tag until it leaves the function that was called.
var wrapping = load(
  `${declarations}
   (func $throwValue (param externref) (throw $script (local.get 0)))
   (func (export "classify") (param externref) (result i32)
     try (result i32)
       (call $throwValue (local.get 0)) (i32.const 0)
     catch $tag drop drop drop drop
     catch $script drop (i32.const -1)
     end)
   (func (export "pass") (param externref) try (call $throwValue (local.get 0)) catch $tag drop drop drop drop drop end)
   (func (export "trap") unreachable)`,
  imports,
);
for (var value of [made, caught(wrapping.trap)]) {
  assertEq(wrapping.classify(value), -1);
  assertEq(caught(() => wrapping.pass(value)), value);
}

var rarely = load(
  `(tag $tag)
   (func (export "run") (param i32) (result i32) (local exnref)
     (loop
       (block (try_table (catch $tag 0)
         (if (i32.and (i32.eqz (ref.is_null (local.get 1))) (local.get 0)) (then (throw_ref (local.get 1))))))
       (br_if 0 (local.tee 0 (i32.sub (local.get 0) (i32.const 1)))))
     (i32.const 5))`,
);
assertEq(rarely.run(300000), 5);

var ending = load(
  `(import "host" "terminate" (func $terminate))
   (func (export "run") try (call $terminate) catch_all end)`,
  { terminate },
);
for (var round = 0; round < 3; round++) assert(isTerminated(ending.run));
