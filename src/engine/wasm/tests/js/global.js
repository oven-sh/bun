var { Global, RuntimeError } = WebAssembly;

throws(TypeError, "WebAssembly.Global expects its first argument to be an object", () => new Global());
for (var value of [undefined, "v128", "anyref"]) {
  var message =
    "WebAssembly.Global expects its 'value' field to be the string 'i32', 'i64', 'f32', 'f64', 'anyfunc', 'funcref', or 'externref'";
  throws(TypeError, message, () => new Global({ value }));
}
var log = [];
new Global(logging(log, { value: "i32" }), { valueOf: () => log.push("valueOf") });
assertDeepEq(log, ["mutable", "value", "valueOf"]);

for (var [value, initial, given, expected] of [
  ["i32", 0, 2 ** 32 + 3, 3],
  ["i64", 0n, "-1", -1n],
  ["f32", 0, 0.1, Math.fround(0.1)],
  ["f64", 0, "1.5", 1.5],
  ["funcref", null, null, null],
  ["anyfunc", null, null, null],
  ["externref", undefined, null, null],
]) {
  assertEq(new Global({ value }).value, initial);
  assertEq(new Global({ value }, undefined).valueOf(), initial);
  assertEq(new Global({ value }, given).value, expected);
  var global = new Global({ value, mutable: 1 });
  global.value = given;
  assertEq(global.value, expected);
  assertDeepEq(global.type(), { mutable: true, value: value.replace("anyfunc", "funcref") });
  throws(TypeError, "WebAssembly.Global.prototype.value attempts to modify immutable global value", () => {
    new Global({ value }).value = given;
  });
}
throws(TypeError, "Argument value did not match the reference type", () => new Global({ value: "funcref" }, () => {}));
assertThrows(TypeError, () => new Global({ value: "i64" }, 1));

var { get, set } = Object.getOwnPropertyDescriptor(Global.prototype, "value");
for (var method of [get, set, Global.prototype.valueOf, Global.prototype.type]) {
  throws(TypeError, "expected |this| value to be an instance of WebAssembly.Global", () => method.call({}));
}
global = new Global({ value: "i32", mutable: true }, 1);
set.call(global);
assertEq(global.value, 0);

// Some values are not for scripts.
var builder = new Builder();
builder.globals.push([kV128, 1, 0xfd, 0x0c].concat(Array(16).fill(0), [0x0b]));
builder.addExport("v128", kExternGlobal, 0).addExport("exnref", kExternGlobal, builder.addGlobal(kExnRef, true));
for (var [name, opaque] of Object.entries(builder.instantiate())) {
  throws(RuntimeError, "Cannot get value of " + name + " global", () => opaque.value);
  throws(TypeError, "Cannot set value of " + name + " global", () => (opaque.value = null));
}
