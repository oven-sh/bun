// Getters of Map, Set and typed arrays, Object.getPrototypeOf, trim, toLowerCase, slice and JSON.stringify called by value: the guarded stubs answer as the host functions do, for every receiver and argument that fails a guard too.
// The output is stored: an executable leaves out the `(evaluating '..')` that plain Bun adds to some messages.
import "../jsc-shell-functions.ts";

const iterations = 100;

function show(value) {
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + Array.prototype.map.call(value, show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  if (typeof value === "string") {
    let text = "'";
    for (let i = 0; i < value.length; ++i) {
      const unit = value.charCodeAt(i);
      text += unit >= 0x20 && unit < 0x7f ? value[i] : "<" + unit.toString(16) + ">";
    }
    return text + "'";
  }
  return Object.is(value, -0) ? "-0" : String(value);
}

function attempt(label, action) {
  try {
    console.log(label, "->", show(action()));
  } catch (error) {
    console.log(label, "throws", error.name + ": " + error.message);
  }
}

function repeat(label, action) {
  let result;
  for (let i = 0; i < iterations; ++i) result = action(i);
  console.log(label, "->", show(result));
}

const call0 = f => f();
const call1 = (f, a) => f(a);
const call2 = (f, a, b) => f(a, b);
const call3 = (f, a, b, c) => f(a, b, c);
const on0 = (f, receiver) => f.call(receiver);
const on1 = (f, receiver, a) => f.call(receiver, a);
const on2 = (f, receiver, a, b) => f.call(receiver, a, b);
const getterOf = (holder, name) => Object.getOwnPropertyDescriptor(holder, name).get;
const rope = (a, b) => a + b;
const other = createGlobalObject();

const size = receiver => receiver.size;
const length = receiver => receiver.length;
const trim = receiver => receiver.trim();
const toLowerCase = receiver => receiver.toLowerCase();
const slice1 = (receiver, start) => receiver.slice(start);
const slice2 = (receiver, start, end) => receiver.slice(start, end);

{
  class M extends Map {}
  class S extends Set {}
  const mapSize = getterOf(Map.prototype, "size");
  const setSize = getterOf(Set.prototype, "size");
  const withProperty = new Map([[1, 1]]);
  withProperty.extra = 1;
  const withOwnSize = new Map([[1, 1]]);
  Object.defineProperty(withOwnSize, "size", { value: "own" });

  for (const [name, table, getter] of [
    ["Map", new Map(), mapSize],
    ["Map subclass", new M(), mapSize],
    ["Set", new Set(), setSize],
    ["Set subclass", new S(), setSize],
  ]) {
    const put = key => (table instanceof Map ? table.set(key, key) : table.add(key));
    attempt(name + " empty", () => [size(table), on0(getter, table)]);
    repeat(name + " growing", i => (put(i % 37), size(table)));
    repeat(name + " growing by value", i => (put("k" + (i % 41)), on0(getter, table)));
    repeat(name + " shrinking", i => (table.delete(i % 11), size(table)));
    attempt(name + " cleared", () => (table.clear(), [size(table), on0(getter, table)]));
    attempt(name + " refilled", () => (put(1.5), put(NaN), put(-0), put(0), [size(table), on0(getter, table)]));
    attempt(name + " with an argument", () => on1(getter, table, 1));
  }
  attempt("Map with a property", () => [size(withProperty), on0(mapSize, withProperty)]);
  attempt("Map with its own size", () => [size(withOwnSize), on0(mapSize, withOwnSize)]);
  attempt("large Map", () => {
    const map = new Map();
    for (let i = 0; i < 5000; ++i) map.set(i, i);
    return [size(map), on0(mapSize, map)];
  });
  for (const [name, receiver] of [
    ["a Set", new Set([1])],
    ["a Map", new Map([[1, 1]])],
    ["a WeakMap", new WeakMap()],
    ["an object", { size: 3 }],
    ["the prototype", Map.prototype],
    ["a number", 1],
    ["a string", "s"],
    ["undefined", undefined],
    ["null", null],
  ]) {
    attempt("Map size on " + name, () => on0(mapSize, receiver));
    attempt("Set size on " + name, () => on0(setSize, receiver));
  }
  attempt("Map size without a receiver", () => call0(mapSize));
  attempt("size of mixed receivers", () => [new Map([[1, 2]]), new Set([1, 2]), { size: "plain" }, new M([[1, 2], [3, 4]]), new Blob(["abc"])].map(size));
  attempt("other realm Map", () => [size(new other.Map([[1, 2]])), on0(mapSize, new other.Map([[1, 2]])), on0(getterOf(other.Map.prototype, "size"), new Map([[1, 2], [3, 4]]))]);
  attempt("other realm Map size on a Set", () => on0(getterOf(other.Map.prototype, "size"), new Set()));
}

{
  const typedArrayLength = getterOf(Object.getPrototypeOf(Uint8Array.prototype), "length");
  class Bytes extends Uint8Array {}
  for (const view of [
    new Int8Array(1),
    new Uint8Array(2),
    new Uint8ClampedArray(3),
    new Int16Array(4),
    new Uint16Array(5),
    new Int32Array(6),
    new Uint32Array(7),
    new Float16Array(8),
    new Float32Array(9),
    new Float64Array(10),
    new BigInt64Array(11),
    new BigUint64Array(12),
    new Bytes(13),
    Buffer.alloc(14),
    new Uint8Array(0),
    new Uint8Array(100000),
    new Uint16Array(new ArrayBuffer(16), 4),
    new Uint16Array(new ArrayBuffer(16), 4, 2),
    new Uint8Array(new SharedArrayBuffer(5)),
  ])
    repeat(view.constructor.name + " length", () => [length(view), on0(typedArrayLength, view)]);

  attempt("length-tracking view", () => {
    const buffer = new ArrayBuffer(8, { maxByteLength: 32 });
    const view = new Uint16Array(buffer, 2);
    const lengths = [length(view), on0(typedArrayLength, view)];
    buffer.resize(32);
    lengths.push(length(view), on0(typedArrayLength, view));
    buffer.resize(1);
    lengths.push(length(view), on0(typedArrayLength, view));
    return lengths;
  });
  attempt("fixed view of a resizable buffer", () => {
    const buffer = new ArrayBuffer(8, { maxByteLength: 32 });
    const view = new Uint8Array(buffer, 0, 8);
    const lengths = [length(view), on0(typedArrayLength, view)];
    buffer.resize(4);
    lengths.push(length(view), on0(typedArrayLength, view));
    buffer.resize(16);
    lengths.push(length(view), on0(typedArrayLength, view));
    return lengths;
  });
  attempt("view of a growable shared buffer", () => {
    const buffer = new SharedArrayBuffer(4, { maxByteLength: 16 });
    const view = new Uint8Array(buffer);
    const lengths = [length(view), on0(typedArrayLength, view)];
    buffer.grow(12);
    lengths.push(length(view), on0(typedArrayLength, view));
    return lengths;
  });
  attempt("detached view", () => {
    const view = new Uint8Array(8);
    const lengths = [length(view), on0(typedArrayLength, view)];
    view.buffer.transfer();
    lengths.push(length(view), on0(typedArrayLength, view));
    return lengths;
  });
  for (const [name, receiver] of [
    ["a DataView", new DataView(new ArrayBuffer(4))],
    ["an ArrayBuffer", new ArrayBuffer(4)],
    ["an array", [1, 2]],
    ["an object", { length: 3 }],
    ["the prototype", Uint8Array.prototype],
    ["a number", 1],
    ["a string", "abc"],
    ["undefined", undefined],
  ])
    attempt("typed array length on " + name, () => on0(typedArrayLength, receiver));
  attempt("typed array length with an argument", () => on1(typedArrayLength, new Uint8Array(3), 1));
  attempt("length of mixed receivers", () => [new Uint8Array(2), [1, 2, 3], "four", { length: "plain" }, function (a, b) {}, new Float64Array(6)].map(length));
  attempt("other realm view", () => [length(new other.Uint8Array(3)), on0(typedArrayLength, new other.Uint8Array(3)), on0(getterOf(Object.getPrototypeOf(other.Uint8Array.prototype), "length"), new Uint8Array(4))]);
}

{
  const getPrototypeOf = Object.getPrototypeOf;
  class Base {}
  class Derived extends Base {}
  function Old() {}
  const changed = new Derived();
  Object.setPrototypeOf(changed, Old.prototype);
  const trapped = new Proxy({}, { getPrototypeOf: () => Array.prototype });
  const names = new Map([
    [Object.prototype, "Object.prototype"],
    [Function.prototype, "Function.prototype"],
    [Array.prototype, "Array.prototype"],
    [Base.prototype, "Base.prototype"],
    [Derived.prototype, "Derived.prototype"],
    [Old.prototype, "Old.prototype"],
    [Base, "Base"],
    [Number.prototype, "Number.prototype"],
    [String.prototype, "String.prototype"],
    [Boolean.prototype, "Boolean.prototype"],
    [Symbol.prototype, "Symbol.prototype"],
    [BigInt.prototype, "BigInt.prototype"],
    [Map.prototype, "Map.prototype"],
    [other.Object.prototype, "other Object.prototype"],
    [null, "null"],
  ]);
  for (const [name, value] of [
    ["a literal", { a: 1 }],
    ["an instance", new Base()],
    ["an instance of a derived class", new Derived()],
    ["an instance of a function", new Old()],
    ["an instance with another prototype", changed],
    ["an object without a prototype", Object.create(null)],
    ["an object created from an instance's class", Object.create(Derived.prototype)],
    ["Object.prototype", Object.prototype],
    ["a class", Base],
    ["a derived class", Derived],
    ["an arrow function", () => {}],
    ["a bound function", Old.bind(null)],
    ["an array", []],
    ["a Map", new Map()],
    ["a Proxy", new Proxy(new Base(), {})],
    ["a Proxy with a trap", trapped],
    ["a number", 1],
    ["a double", 1.5],
    ["a string", "s"],
    ["a boolean", true],
    ["a symbol", Symbol()],
    ["a BigInt", 1n],
    ["an object of another realm", new other.Object()],
  ])
    repeat("getPrototypeOf " + name, () => names.get(call1(getPrototypeOf, value)) ?? "unnamed");
  attempt("getPrototypeOf undefined", () => call1(getPrototypeOf, undefined));
  attempt("getPrototypeOf null", () => call1(getPrototypeOf, null));
  attempt("getPrototypeOf without an argument", () => call0(getPrototypeOf));
  attempt("getPrototypeOf with two arguments", () => names.get(call2(getPrototypeOf, [], {})));
  attempt("getPrototypeOf a revoked Proxy", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    return call1(getPrototypeOf, proxy);
  });
  attempt("other realm getPrototypeOf", () => [names.get(call1(other.Object.getPrototypeOf, {})), names.get(call1(other.Object.getPrototypeOf, 1)) ?? "unnamed"]);
}

const texts = [
  "",
  " ",
  "a",
  "A",
  "plain",
  "Mixed Case",
  "UPPER",
  " leading",
  "trailing ",
  "  both  ",
  "\ttab\t",
  "\nline\n",
  "\r\n\v\f",
  "in ner",
  "~tilde~",
  "!bang!",
  "\x7fdelete\x7f",
  "\xa0no-break\xa0",
  "\xc0\xc9\xd6 LATIN",
  "\xdf sharp",
  "\xff",
  "﻿mark﻿",
  " em ",
  "᠎mongolian᠎",
  "İ DOTTED",
  "ΣΑΣ",
  "𐐀 DESERET",
  "\ud800 lone",
  "0123456789abcdef0123456789ABCDEF",
  "x".repeat(300) + "Y",
];

for (const text of texts) {
  repeat("trim " + show(text), () => trim(text));
  repeat("toLowerCase " + show(text), () => toLowerCase(text));
}
repeat("trim of a rope", i => trim(rope(" left" + (i % 3), "right ")));
repeat("trim of a rope without spaces", i => trim(rope("left" + (i % 3), "right")));
repeat("trim of a substring", i => trim("(  inside  )".slice(1 + (i % 2), -1)));
repeat("toLowerCase of a rope", i => toLowerCase(rope("LEFT" + (i % 3), "Right")));
repeat("toLowerCase of a substring", i => toLowerCase("abcDEFghi".slice(i % 3, 7)));

{
  const stringTrim = String.prototype.trim;
  const stringToLowerCase = String.prototype.toLowerCase;
  const stringSlice = String.prototype.slice;
  const convertible = { toString: () => " Converted " };
  for (const [name, receiver] of [
    ["a String object", new String(" Object ")],
    ["a number", 12],
    ["a double", 1.5],
    ["a boolean", true],
    ["an array", [" A ", "B "]],
    ["an object", convertible],
    ["a symbol", Symbol("s")],
    ["a BigInt", 5n],
    ["undefined", undefined],
    ["null", null],
  ]) {
    attempt("trim on " + name, () => on0(stringTrim, receiver));
    attempt("toLowerCase on " + name, () => on0(stringToLowerCase, receiver));
    attempt("slice on " + name, () => on1(stringSlice, receiver, 1));
    attempt("slice with an end on " + name, () => on2(stringSlice, receiver, 1, -1));
  }
  attempt("trim without a receiver", () => call0(stringTrim));
  attempt("toLowerCase without a receiver", () => call0(stringToLowerCase));
  attempt("slice without a receiver", () => call1(stringSlice, 1));
  attempt("trim with an argument", () => on1(stringTrim, " a ", 1));
  attempt("toLowerCase with an argument", () => on1(stringToLowerCase, "AB", "tr"));
  attempt("methods of mixed receivers", () =>
    [" S ", { trim: () => "own trim", toLowerCase: () => "own toLowerCase", slice: () => "own slice" }, new String(" O ")].map(receiver => [trim(receiver), toLowerCase(receiver), slice1(receiver, 1)]));
  attempt("other realm methods", () => [on0(other.String.prototype.trim, " A "), on0(other.String.prototype.toLowerCase, " A "), on1(other.String.prototype.slice, " A ", 1), on2(other.String.prototype.slice, " A ", 1, 2)]);
  attempt("other realm trim on null", () => {
    try {
      return on0(other.String.prototype.trim, null);
    } catch (error) {
      return [error instanceof TypeError, error instanceof other.TypeError];
    }
  });
}

{
  const positions = [0, 1, 2, 5, 6, 7, 100, -1, -2, -5, -6, -7, -100, 2147483647, -2147483648];
  for (const text of ["", "a", "abcdef", "αβγδεζ", "ab\xe9def"]) {
    attempt("slice(start) of " + show(text), () => positions.map(start => slice1(text, start)));
    for (const start of positions) attempt("slice(" + start + ", end) of " + show(text), () => positions.map(end => slice2(text, start, end)));
  }
  repeat("slice of a rope", i => slice2(rope("left" + (i % 3), "right"), 2, -2));
  repeat("slice of a substring", i => slice2("0123456789".slice(2), 1 + (i % 2), -1));
  repeat("slice of the whole string", () => slice1("whole", 0));
  for (const [name, argument] of [
    ["a double", 1.5],
    ["a negative double", -1.5],
    ["-0", -0],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["4294967297", 4294967297],
    ["a string", "2"],
    ["text", "x"],
    ["true", true],
    ["null", null],
    ["undefined", undefined],
    ["an object", { valueOf: () => 2 }],
    ["a symbol", Symbol()],
    ["a BigInt", 1n],
  ]) {
    attempt("slice from " + name, () => slice1("abcdef", argument));
    attempt("slice to " + name, () => slice2("abcdef", 1, argument));
    attempt("slice from " + name + " to 4", () => slice2("abcdef", argument, 4));
  }
  attempt("slice without arguments", () => on0(String.prototype.slice, "abc"));
  attempt("slice with three arguments", () => String.prototype.slice.call("abcdef", 1, 3, 5));
  attempt("order of conversions", () => {
    const order = [];
    const result = slice2("abcdef", { valueOf: () => (order.push("start"), 1) }, { valueOf: () => (order.push("end"), 3) });
    return [result, order];
  });
}

{
  const stringify = JSON.stringify;
  for (const text of texts) repeat("stringify " + show(text), () => call1(stringify, text));
  for (const text of [
    '"',
    "\\",
    'say "hi"',
    "back\\slash",
    "\b\f\n\r\t",
    "\x00\x01\x1f",
    "/slash/",
    "0123456789abcde\"",
    "0123456789abcdef\n",
    "0123456789abcdef0123456789abcde\\",
    "abc\"",
    "abcdefg\n",
    "  ",
    "😀",
    "\udc00\ud800",
    "a\ud800",
    "\udfffz",
    "q".repeat(9000),
    "q".repeat(9000) + '"',
    "π".repeat(9000),
  ])
    attempt("stringify " + (text.length > 40 ? "a text of length " + text.length + " that ends with " + show(text.slice(-1)) : show(text)), () => {
      const result = call1(stringify, text);
      return text.length > 40 ? [result.length, result.slice(0, 3), result.slice(-3), JSON.parse(result) === text] : result;
    });
  repeat("stringify a rope", i => call1(stringify, rope("left" + (i % 3), 'ri"ght')));
  repeat("stringify a rope without escapes", i => call1(stringify, rope("left" + (i % 3), "right")));
  repeat("stringify a substring", i => call1(stringify, "0123456789".slice(1 + (i % 2), -1)));
  for (const number of [
    0,
    -0,
    1,
    -1,
    9,
    10,
    255,
    256,
    65536,
    2147483647,
    -2147483648,
    2147483648,
    -2147483649,
    4294967296,
    9007199254740991,
    9007199254740992,
    0.1,
    -0.5,
    1.5,
    123.456,
    1e21,
    1e-7,
    1.7976931348623157e308,
    5e-324,
    NaN,
    Infinity,
    -Infinity,
  ])
    repeat("stringify " + show(number), () => call1(stringify, number));
  repeat("stringify many numbers", i => call1(stringify, i * 1000 + i / 4));
  for (const [name, value] of [
    ["true", true],
    ["false", false],
    ["null", null],
    ["undefined", undefined],
    ["a symbol", Symbol("s")],
    ["a function", () => {}],
    ["a BigInt", 1n],
    ["an object", { a: [1, "two", null] }],
    ["an array", [undefined, () => {}, Symbol()]],
    ["a String object", new String('q"')],
    ["a Number object", new Number(1.5)],
    ["a Boolean object", new Boolean(false)],
    ["an object with toJSON", { toJSON: () => "from toJSON" }],
    ["a Date", new Date(0)],
    ["a Map", new Map([[1, 2]])],
  ])
    attempt("stringify " + name, () => call1(stringify, value));
  attempt("stringify a cycle", () => {
    const cycle = {};
    cycle.self = cycle;
    return call1(stringify, cycle);
  });
  attempt("stringify without an argument", () => call0(stringify));
  attempt("stringify a string with a replacer", () => call2(stringify, "a", (key, value) => value + "!"));
  attempt("stringify a number with a replacer", () => call2(stringify, 1, () => "replaced"));
  attempt("stringify a string with null and an indent", () => call3(stringify, "a", null, 2));
  attempt("stringify with a receiver", () => on1(stringify, 5, "a"));
  attempt("stringify a BigInt with toJSON", () => {
    BigInt.prototype.toJSON = function () {
      return "big " + this;
    };
    try {
      return call1(stringify, 7n);
    } finally {
      delete BigInt.prototype.toJSON;
    }
  });
  attempt("other realm stringify", () => [call1(other.JSON.stringify, 'a"'), call1(other.JSON.stringify, 1.5), call1(other.JSON.stringify, null), call1(other.JSON.stringify, undefined)]);
  attempt("other realm stringify of a BigInt", () => call1(other.JSON.stringify, 1n));
  attempt("results are strings", () => [typeof call1(stringify, "a"), typeof call1(stringify, 1), typeof call1(stringify, true), typeof call1(stringify, null), typeof call1(stringify, undefined)]);
}
