var types = `
  (type $point (sub (struct (field i32) (field (mut anyref)))))
  (type $pixel (sub final $point (struct (field i32) (field (mut anyref)) (field i8))))
  (type $list (array (mut anyref)))
  (type $bytes (array (mut i8)))`;

var maker = load(
  `${types}
   (func (export "point") (param i32 anyref) (result anyref) (struct.new $point (local.get 0) (local.get 1)))
   (func (export "pixel") (result anyref) (struct.new_default $pixel))
   (func (export "list") (param anyref i32) (result anyref) (array.new $list (local.get 0) (local.get 1)))
   (func (export "bytes") (param i32) (result anyref) (array.new_default $bytes (local.get 0)))
   (func (export "chain") (param i32) (result anyref) (local $last anyref)
     (loop
       (local.set $last (struct.new $point (local.get 0) (local.get $last)))
       (drop (array.new_fixed $list 2 (local.get $last) (ref.null any)))
       (br_if 0 (local.tee 0 (i32.sub (local.get 0) (i32.const 1)))))
     (local.get $last))`,
);

function reader() {
  return load(
    `${types}
     (func (export "kinds") (param anyref) (result i32 i32 i32 i32 i32 i32 i32)
       (ref.test (ref eq) (local.get 0)) (ref.test (ref i31) (local.get 0))
       (ref.test (ref struct) (local.get 0)) (ref.test (ref array) (local.get 0))
       (ref.test (ref $point) (local.get 0)) (ref.test (ref $pixel) (local.get 0)) (ref.test (ref $list) (local.get 0)))
     (func (export "next") (param (ref $point)) (result anyref) (struct.get $point 1 (local.get 0)))
     (func (export "setNext") (param (ref $point) anyref) (struct.set $point 1 (local.get 0) (local.get 1)))
     (func (export "set") (param (ref $list) i32 anyref) (array.set $list (local.get 0) (local.get 1) (local.get 2)))
     (func (export "get") (param (ref $list) i32) (result anyref) (array.get $list (local.get 0) (local.get 1)))
     (func (export "sum") (param anyref) (result i32) (local i32)
       (loop
         (local.set 1 (i32.add (local.get 1) (struct.get $point 0 (ref.cast (ref $point) (local.get 0)))))
         (local.set 0 (struct.get $point 1 (ref.cast (ref $point) (local.get 0))))
         (br_if 0 (i32.eqz (ref.is_null (local.get 0)))))
       (local.get 1))
     (func (export "small") (param i31ref) (result i32) (i31.get_s (local.get 0)))
     (func (export "same") (param externref) (result externref)
       (extern.convert_any (any.convert_extern (local.get 0))))`,
  );
}

var point = maker.point(1, null),
  pixel = maker.pixel(),
  list = maker.list(point, 3000),
  bytes = maker.bytes(5),
  chain = maker.chain(20000);
maker = undefined;
collect(true);

var wasm = reader();
for (var [value, expected] of [
  [point, "1,0,1,0,1,0,0"],
  [pixel, "1,0,1,0,1,1,0"],
  [list, "1,0,0,1,0,0,1"],
  [bytes, "1,0,0,1,0,0,0"],
  [2 ** 30 - 1, "1,1,0,0,0,0,0"],
  [-(2 ** 30), "1,1,0,0,0,0,0"],
  [2 ** 30, "0,0,0,0,0,0,0"],
  [-0, "0,0,0,0,0,0,0"],
  [{}, "0,0,0,0,0,0,0"],
  ["text", "0,0,0,0,0,0,0"],
  [undefined, "0,0,0,0,0,0,0"],
  [null, "0,0,0,0,0,0,0"],
]) {
  assertEq(wasm.kinds(value).join(), expected);
  assertEq(wasm.same(value), value);
}
assertEq(wasm.sum(chain), (20000 * 20001) / 2);
assertEq(wasm.small(-3), -3);
for (var wrong of [list, {}, 1, null]) assertThrows(TypeError, () => wasm.next(wrong));
assertThrows(TypeError, () => wasm.small(0.5));
assertThrows(WebAssembly.RuntimeError, () => wasm.sum(bytes));
assertThrows(WebAssembly.RuntimeError, () => wasm.get(list, 3000));

wasm.setNext(pixel, { name: "field" });
wasm.set(list, 2999, { name: "element" });
collect(false);
assertDeepEq([wasm.next(pixel).name, wasm.get(list, 2999).name, wasm.get(list, 0) === point], ["field", "element", true]);

class Same {
  constructor(object) {
    return object;
  }
}
class Field extends Same {
  x = 1;
}
class Private extends Same {
  #x = 1;
}
for (var object of [pixel, list]) {
  assertDeepEq([typeof object, object.x, object[0], "x" in object], ["object", undefined, undefined, false]);
  assertDeepEq([Reflect.ownKeys(object), Object.getPrototypeOf(object), Object.isExtensible(object)], [[], null, false]);
  assertDeepEq([Reflect.defineProperty(object, "x", {}), Reflect.setPrototypeOf(object, null)], [false, false]);
  assertEq(Reflect.set({}, "x", 1, object), false);
  assertEq(Object.create(object).x, undefined);
  assertEq(new WeakMap([[object, 1]]).get(object), 1);
  for (var change of [
    () => (object.x = 1),
    () => (object[0] = 1),
    () => delete object.x,
    () => Object.freeze(object),
    () => Object.assign(object, { x: 1 }),
    () => Array.prototype.push.call(object, 1),
    () => new Field(object),
    () => new Private(object),
    () => String(object),
  ]) {
    assertThrows(TypeError, change);
  }
}
assertEq(wasm.next(pixel).name, "field");

// References far into a struct, and at the ends of what the first 64 words cover.
for (var padding of [62, 63, 64, 600]) {
  var wide = load(
    `(type $wide (struct (field (mut anyref)) ${"(field i64) ".repeat(padding)} (field (mut anyref))))
     (func (export "make") (result (ref $wide)) (struct.new_default $wide))
     (func (export "set") (param (ref $wide) anyref anyref)
       (struct.set $wide 0 (local.get 0) (local.get 1)) (struct.set $wide ${padding + 1} (local.get 0) (local.get 2)))
     (func (export "get") (param (ref $wide)) (result anyref i64 anyref)
       (struct.get $wide 0 (local.get 0)) (struct.get $wide ${padding} (local.get 0))
       (struct.get $wide ${padding + 1} (local.get 0)))`,
  );
  var made = wide.make();
  assertEq(wide.get(made).join(), ",0,");
  wide.set(made, ["first"], ["last"]);
  collect(true);
  assertEq(wide.get(made).join(), "first,0,last");
}
