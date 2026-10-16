// How often util.inspect reads `href` of a value, for 30 shapes. Prints "<shape>: <reads>".
const util = require("node:util");
let reads = 0;
const getter = { get() { reads++; return "http://example.com/a"; }, configurable: true };
const own = v => (Object.defineProperty(v, "href", getter), v);
class WithGetter { get href() { reads++; return "http://example.com/a"; } }
class Sub extends WithGetter {}
class Iter { *[Symbol.iterator]() {} get href() { reads++; return "x"; } }
class CountedURL extends URL { get href() { reads++; return super.href; } }
function Old() {} Object.defineProperty(Old.prototype, "href", getter);
const shapes = {
  // values that are not a URL
  "class instance, getter on the prototype": () => new WithGetter(),
  "subclass instance": () => new Sub(),
  "class instance, own getter": () => own(new (class A {})()),
  "function-constructor instance": () => new Old(),
  "null-prototype object, own getter": () => own(Object.create(null)),
  "Object.create(object with the getter)": () => Object.create(own({})),
  "instance of a class with Symbol.iterator": () => new Iter(),
  "plain object, own getter": () => own({}),
  "array, own getter": () => own([1, 2]),
  "Map, own getter": () => own(new Map([[1, 2]])),
  "Set, own getter": () => own(new Set([1])),
  "WeakMap, own getter": () => own(new WeakMap()),
  "WeakSet, own getter": () => own(new WeakSet()),
  "Promise, own getter": () => own(Promise.resolve(1)),
  "Date, own getter": () => own(new Date(0)),
  "RegExp, own getter": () => own(/a/),
  "Error, own getter": () => own(new Error("e")),
  "function, own getter": () => own(function f() {}),
  "class, own getter": () => own(class K {}),
  "Uint8Array, own getter": () => own(new Uint8Array(2)),
  "ArrayBuffer, own getter": () => own(new ArrayBuffer(2)),
  "DataView, own getter": () => own(new DataView(new ArrayBuffer(2))),
  "boxed String, own getter": () => own(new String("s")),
  "boxed Number, own getter": () => own(new Number(1)),
  "boxed Symbol, own getter": () => own(Object(Symbol("s"))),
  "arguments object, own getter": () => own((function () { return arguments; })(1)),
  "generator object, own getter": () => own((function* () {})()),
  "Proxy of a class instance with the getter": () => new Proxy(new WithGetter(), {}),
  "URLSearchParams, own getter": () => own(new URLSearchParams("a=1")),
  "Blob, own getter": () => own(new Blob(["x"])),
  // a URL
  "URL subclass with a getter": () => new CountedURL("http://example.com/a"),
};
for (const [name, make] of Object.entries(shapes)) {
  const value = make();
  reads = 0;
  let note = "";
  try { util.inspect(value, { customInspect: false }); } catch (e) { note = " (throws " + e.name + ")"; }
  console.log(name + ": " + reads + note);
}
