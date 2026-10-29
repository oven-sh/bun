// Getters of Map, Set and typed arrays, Object.getPrototypeOf, trim, toLowerCase, slice and JSON.stringify called by value: the guarded stubs answer as the host functions do, for every receiver and argument that fails a guard too.
// The output is stored: an executable leaves out the `(evaluating '..')` that plain Bun adds to some messages.
import "../../fixtures/jsc-shell-functions.ts";

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
/* Output:
Map empty -> [0, 0]
Map growing -> 37
Map growing by value -> 78
Map shrinking -> 67
Map cleared -> [0, 0]
Map refilled -> [3, 3]
Map with an argument -> 3
Map subclass empty -> [0, 0]
Map subclass growing -> 37
Map subclass growing by value -> 78
Map subclass shrinking -> 67
Map subclass cleared -> [0, 0]
Map subclass refilled -> [3, 3]
Map subclass with an argument -> 3
Set empty -> [0, 0]
Set growing -> 37
Set growing by value -> 78
Set shrinking -> 67
Set cleared -> [0, 0]
Set refilled -> [3, 3]
Set with an argument -> 3
Set subclass empty -> [0, 0]
Set subclass growing -> 37
Set subclass growing by value -> 78
Set subclass shrinking -> 67
Set subclass cleared -> [0, 0]
Set subclass refilled -> [3, 3]
Set subclass with an argument -> 3
Map with a property -> [1, 1]
Map with its own size -> ['own', 1]
large Map -> [5000, 5000]
Map size on a Set throws TypeError: Map operation called on non-Map object
Set size on a Set -> 1
Map size on a Map -> 1
Set size on a Map throws TypeError: Set operation called on non-Set object
Map size on a WeakMap throws TypeError: Map operation called on non-Map object
Set size on a WeakMap throws TypeError: Set operation called on non-Set object
Map size on an object throws TypeError: Map operation called on non-Map object
Set size on an object throws TypeError: Set operation called on non-Set object
Map size on the prototype throws TypeError: Map operation called on non-Map object
Set size on the prototype throws TypeError: Set operation called on non-Set object
Map size on a number throws TypeError: 1 is not an object
Set size on a number throws TypeError: 1 is not an object
Map size on a string throws TypeError: Map operation called on non-Map object
Set size on a string throws TypeError: Set operation called on non-Set object
Map size on undefined throws TypeError: undefined is not an object
Set size on undefined throws TypeError: undefined is not an object
Map size on null throws TypeError: null is not an object
Set size on null throws TypeError: null is not an object
Map size without a receiver throws TypeError: undefined is not an object
size of mixed receivers -> [1, 2, 'plain', 2, 3]
other realm Map -> [1, 1, 2]
other realm Map size on a Set throws TypeError: Map operation called on non-Map object
Int8Array length -> [1, 1]
Uint8Array length -> [2, 2]
Uint8ClampedArray length -> [3, 3]
Int16Array length -> [4, 4]
Uint16Array length -> [5, 5]
Int32Array length -> [6, 6]
Uint32Array length -> [7, 7]
Float16Array length -> [8, 8]
Float32Array length -> [9, 9]
Float64Array length -> [10, 10]
BigInt64Array length -> [11, 11]
BigUint64Array length -> [12, 12]
Bytes length -> [13, 13]
Buffer length -> [14, 14]
Uint8Array length -> [0, 0]
Uint8Array length -> [100000, 100000]
Uint16Array length -> [6, 6]
Uint16Array length -> [2, 2]
Uint8Array length -> [5, 5]
length-tracking view -> [3, 3, 15, 15, 0, 0]
fixed view of a resizable buffer -> [8, 8, 0, 0, 8, 8]
view of a growable shared buffer -> [4, 4, 12, 12]
detached view -> [8, 8, 0, 0]
typed array length on a DataView throws TypeError: Receiver should be a typed array view
typed array length on an ArrayBuffer throws TypeError: Receiver should be a typed array view
typed array length on an array throws TypeError: Receiver should be a typed array view
typed array length on an object throws TypeError: Receiver should be a typed array view
typed array length on the prototype throws TypeError: Receiver should be a typed array view
typed array length on a number throws TypeError: Receiver should be a typed array view but was not an object
typed array length on a string throws TypeError: Receiver should be a typed array view but was not an object
typed array length on undefined throws TypeError: Receiver should be a typed array view but was not an object
typed array length with an argument -> 3
length of mixed receivers -> [2, 3, 4, 'plain', 2, 6]
other realm view -> [3, 3, 4]
getPrototypeOf a literal -> 'Object.prototype'
getPrototypeOf an instance -> 'Base.prototype'
getPrototypeOf an instance of a derived class -> 'Derived.prototype'
getPrototypeOf an instance of a function -> 'Old.prototype'
getPrototypeOf an instance with another prototype -> 'Old.prototype'
getPrototypeOf an object without a prototype -> 'null'
getPrototypeOf an object created from an instance's class -> 'Derived.prototype'
getPrototypeOf Object.prototype -> 'null'
getPrototypeOf a class -> 'Function.prototype'
getPrototypeOf a derived class -> 'Base'
getPrototypeOf an arrow function -> 'Function.prototype'
getPrototypeOf a bound function -> 'Function.prototype'
getPrototypeOf an array -> 'Array.prototype'
getPrototypeOf a Map -> 'Map.prototype'
getPrototypeOf a Proxy -> 'Base.prototype'
getPrototypeOf a Proxy with a trap -> 'Array.prototype'
getPrototypeOf a number -> 'Number.prototype'
getPrototypeOf a double -> 'Number.prototype'
getPrototypeOf a string -> 'String.prototype'
getPrototypeOf a boolean -> 'Boolean.prototype'
getPrototypeOf a symbol -> 'Symbol.prototype'
getPrototypeOf a BigInt -> 'BigInt.prototype'
getPrototypeOf an object of another realm -> 'other Object.prototype'
getPrototypeOf undefined throws TypeError: undefined is not an object
getPrototypeOf null throws TypeError: null is not an object
getPrototypeOf without an argument throws TypeError: undefined is not an object
getPrototypeOf with two arguments -> 'Array.prototype'
getPrototypeOf a revoked Proxy throws TypeError: Proxy has already been revoked. No more operations are allowed to be performed on it
other realm getPrototypeOf -> ['Object.prototype', 'unnamed']
trim '' -> ''
toLowerCase '' -> ''
trim ' ' -> ''
toLowerCase ' ' -> ' '
trim 'a' -> 'a'
toLowerCase 'a' -> 'a'
trim 'A' -> 'A'
toLowerCase 'A' -> 'a'
trim 'plain' -> 'plain'
toLowerCase 'plain' -> 'plain'
trim 'Mixed Case' -> 'Mixed Case'
toLowerCase 'Mixed Case' -> 'mixed case'
trim 'UPPER' -> 'UPPER'
toLowerCase 'UPPER' -> 'upper'
trim ' leading' -> 'leading'
toLowerCase ' leading' -> ' leading'
trim 'trailing ' -> 'trailing'
toLowerCase 'trailing ' -> 'trailing '
trim '  both  ' -> 'both'
toLowerCase '  both  ' -> '  both  '
trim '<9>tab<9>' -> 'tab'
toLowerCase '<9>tab<9>' -> '<9>tab<9>'
trim '<a>line<a>' -> 'line'
toLowerCase '<a>line<a>' -> '<a>line<a>'
trim '<d><a><b><c>' -> ''
toLowerCase '<d><a><b><c>' -> '<d><a><b><c>'
trim 'in ner' -> 'in ner'
toLowerCase 'in ner' -> 'in ner'
trim '~tilde~' -> '~tilde~'
toLowerCase '~tilde~' -> '~tilde~'
trim '!bang!' -> '!bang!'
toLowerCase '!bang!' -> '!bang!'
trim '<7f>delete<7f>' -> '<7f>delete<7f>'
toLowerCase '<7f>delete<7f>' -> '<7f>delete<7f>'
trim '<a0>no-break<a0>' -> 'no-break'
toLowerCase '<a0>no-break<a0>' -> '<a0>no-break<a0>'
trim '<c0><c9><d6> LATIN' -> '<c0><c9><d6> LATIN'
toLowerCase '<c0><c9><d6> LATIN' -> '<e0><e9><f6> latin'
trim '<df> sharp' -> '<df> sharp'
toLowerCase '<df> sharp' -> '<df> sharp'
trim '<ff>' -> '<ff>'
toLowerCase '<ff>' -> '<ff>'
trim '<feff>mark<feff>' -> 'mark'
toLowerCase '<feff>mark<feff>' -> '<feff>mark<feff>'
trim '<2003>em<2003>' -> 'em'
toLowerCase '<2003>em<2003>' -> '<2003>em<2003>'
trim '<180e>mongolian<180e>' -> '<180e>mongolian<180e>'
toLowerCase '<180e>mongolian<180e>' -> '<180e>mongolian<180e>'
trim '<130> DOTTED' -> '<130> DOTTED'
toLowerCase '<130> DOTTED' -> 'i<307> dotted'
trim '<3a3><391><3a3>' -> '<3a3><391><3a3>'
toLowerCase '<3a3><391><3a3>' -> '<3c3><3b1><3c2>'
trim '<d801><dc00> DESERET' -> '<d801><dc00> DESERET'
toLowerCase '<d801><dc00> DESERET' -> '<d801><dc28> deseret'
trim '<d800> lone' -> '<d800> lone'
toLowerCase '<d800> lone' -> '<d800> lone'
trim '0123456789abcdef0123456789ABCDEF' -> '0123456789abcdef0123456789ABCDEF'
toLowerCase '0123456789abcdef0123456789ABCDEF' -> '0123456789abcdef0123456789abcdef'
trim 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxY' -> 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxY'
toLowerCase 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxY' -> 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxy'
trim of a rope -> 'left0right'
trim of a rope without spaces -> 'left0right'
trim of a substring -> 'inside'
toLowerCase of a rope -> 'left0right'
toLowerCase of a substring -> 'abcdefg'
trim on a String object -> 'Object'
toLowerCase on a String object -> ' object '
slice on a String object -> 'Object '
slice with an end on a String object -> 'Object'
trim on a number -> '12'
toLowerCase on a number -> '12'
slice on a number -> '2'
slice with an end on a number -> ''
trim on a double -> '1.5'
toLowerCase on a double -> '1.5'
slice on a double -> '.5'
slice with an end on a double -> '.'
trim on a boolean -> 'true'
toLowerCase on a boolean -> 'true'
slice on a boolean -> 'rue'
slice with an end on a boolean -> 'ru'
trim on an array -> 'A ,B'
toLowerCase on an array -> ' a ,b '
slice on an array -> 'A ,B '
slice with an end on an array -> 'A ,B'
trim on an object -> 'Converted'
toLowerCase on an object -> ' converted '
slice on an object -> 'Converted '
slice with an end on an object -> 'Converted'
trim on a symbol throws TypeError: Cannot convert a symbol to a string
toLowerCase on a symbol throws TypeError: Cannot convert a symbol to a string
slice on a symbol throws TypeError: Cannot convert a symbol to a string
slice with an end on a symbol throws TypeError: Cannot convert a symbol to a string
trim on a BigInt -> '5'
toLowerCase on a BigInt -> '5'
slice on a BigInt -> ''
slice with an end on a BigInt -> ''
trim on undefined throws TypeError: Type error
toLowerCase on undefined throws TypeError: Type error
slice on undefined throws TypeError: Type error
slice with an end on undefined throws TypeError: Type error
trim on null throws TypeError: Type error
toLowerCase on null throws TypeError: Type error
slice on null throws TypeError: Type error
slice with an end on null throws TypeError: Type error
trim without a receiver throws TypeError: Type error
toLowerCase without a receiver throws TypeError: Type error
slice without a receiver throws TypeError: Type error
trim with an argument -> 'a'
toLowerCase with an argument -> 'ab'
methods of mixed receivers -> [['S', ' s ', 'S '], ['own trim', 'own toLowerCase', 'own slice'], ['O', ' o ', 'O ']]
other realm methods -> ['A', ' a ', 'A ', 'A']
other realm trim on null -> [false, true]
slice(start) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(0, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(1, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(2, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(5, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(6, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(7, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(100, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-1, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-2, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-5, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-6, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-7, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-100, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(2147483647, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-2147483648, end) of '' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(start) of 'a' -> ['a', '', '', '', '', '', '', 'a', 'a', 'a', 'a', 'a', 'a', '', 'a']
slice(0, end) of 'a' -> ['', 'a', 'a', 'a', 'a', 'a', 'a', '', '', '', '', '', '', 'a', '']
slice(1, end) of 'a' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(2, end) of 'a' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(5, end) of 'a' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(6, end) of 'a' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(7, end) of 'a' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(100, end) of 'a' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-1, end) of 'a' -> ['', 'a', 'a', 'a', 'a', 'a', 'a', '', '', '', '', '', '', 'a', '']
slice(-2, end) of 'a' -> ['', 'a', 'a', 'a', 'a', 'a', 'a', '', '', '', '', '', '', 'a', '']
slice(-5, end) of 'a' -> ['', 'a', 'a', 'a', 'a', 'a', 'a', '', '', '', '', '', '', 'a', '']
slice(-6, end) of 'a' -> ['', 'a', 'a', 'a', 'a', 'a', 'a', '', '', '', '', '', '', 'a', '']
slice(-7, end) of 'a' -> ['', 'a', 'a', 'a', 'a', 'a', 'a', '', '', '', '', '', '', 'a', '']
slice(-100, end) of 'a' -> ['', 'a', 'a', 'a', 'a', 'a', 'a', '', '', '', '', '', '', 'a', '']
slice(2147483647, end) of 'a' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-2147483648, end) of 'a' -> ['', 'a', 'a', 'a', 'a', 'a', 'a', '', '', '', '', '', '', 'a', '']
slice(start) of 'abcdef' -> ['abcdef', 'bcdef', 'cdef', 'f', '', '', '', 'f', 'ef', 'bcdef', 'abcdef', 'abcdef', 'abcdef', '', 'abcdef']
slice(0, end) of 'abcdef' -> ['', 'a', 'ab', 'abcde', 'abcdef', 'abcdef', 'abcdef', 'abcde', 'abcd', 'a', '', '', '', 'abcdef', '']
slice(1, end) of 'abcdef' -> ['', '', 'b', 'bcde', 'bcdef', 'bcdef', 'bcdef', 'bcde', 'bcd', '', '', '', '', 'bcdef', '']
slice(2, end) of 'abcdef' -> ['', '', '', 'cde', 'cdef', 'cdef', 'cdef', 'cde', 'cd', '', '', '', '', 'cdef', '']
slice(5, end) of 'abcdef' -> ['', '', '', '', 'f', 'f', 'f', '', '', '', '', '', '', 'f', '']
slice(6, end) of 'abcdef' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(7, end) of 'abcdef' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(100, end) of 'abcdef' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-1, end) of 'abcdef' -> ['', '', '', '', 'f', 'f', 'f', '', '', '', '', '', '', 'f', '']
slice(-2, end) of 'abcdef' -> ['', '', '', 'e', 'ef', 'ef', 'ef', 'e', '', '', '', '', '', 'ef', '']
slice(-5, end) of 'abcdef' -> ['', '', 'b', 'bcde', 'bcdef', 'bcdef', 'bcdef', 'bcde', 'bcd', '', '', '', '', 'bcdef', '']
slice(-6, end) of 'abcdef' -> ['', 'a', 'ab', 'abcde', 'abcdef', 'abcdef', 'abcdef', 'abcde', 'abcd', 'a', '', '', '', 'abcdef', '']
slice(-7, end) of 'abcdef' -> ['', 'a', 'ab', 'abcde', 'abcdef', 'abcdef', 'abcdef', 'abcde', 'abcd', 'a', '', '', '', 'abcdef', '']
slice(-100, end) of 'abcdef' -> ['', 'a', 'ab', 'abcde', 'abcdef', 'abcdef', 'abcdef', 'abcde', 'abcd', 'a', '', '', '', 'abcdef', '']
slice(2147483647, end) of 'abcdef' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-2147483648, end) of 'abcdef' -> ['', 'a', 'ab', 'abcde', 'abcdef', 'abcdef', 'abcdef', 'abcde', 'abcd', 'a', '', '', '', 'abcdef', '']
slice(start) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b2><3b3><3b4><3b5><3b6>', '<3b3><3b4><3b5><3b6>', '<3b6>', '', '', '', '<3b6>', '<3b5><3b6>', '<3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '', '<3b1><3b2><3b3><3b4><3b5><3b6>']
slice(0, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '<3b1>', '<3b1><3b2>', '<3b1><3b2><3b3><3b4><3b5>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5>', '<3b1><3b2><3b3><3b4>', '<3b1>', '', '', '', '<3b1><3b2><3b3><3b4><3b5><3b6>', '']
slice(1, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '', '<3b2>', '<3b2><3b3><3b4><3b5>', '<3b2><3b3><3b4><3b5><3b6>', '<3b2><3b3><3b4><3b5><3b6>', '<3b2><3b3><3b4><3b5><3b6>', '<3b2><3b3><3b4><3b5>', '<3b2><3b3><3b4>', '', '', '', '', '<3b2><3b3><3b4><3b5><3b6>', '']
slice(2, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '', '', '<3b3><3b4><3b5>', '<3b3><3b4><3b5><3b6>', '<3b3><3b4><3b5><3b6>', '<3b3><3b4><3b5><3b6>', '<3b3><3b4><3b5>', '<3b3><3b4>', '', '', '', '', '<3b3><3b4><3b5><3b6>', '']
slice(5, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '', '', '', '<3b6>', '<3b6>', '<3b6>', '', '', '', '', '', '', '<3b6>', '']
slice(6, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(7, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(100, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-1, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '', '', '', '<3b6>', '<3b6>', '<3b6>', '', '', '', '', '', '', '<3b6>', '']
slice(-2, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '', '', '<3b5>', '<3b5><3b6>', '<3b5><3b6>', '<3b5><3b6>', '<3b5>', '', '', '', '', '', '<3b5><3b6>', '']
slice(-5, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '', '<3b2>', '<3b2><3b3><3b4><3b5>', '<3b2><3b3><3b4><3b5><3b6>', '<3b2><3b3><3b4><3b5><3b6>', '<3b2><3b3><3b4><3b5><3b6>', '<3b2><3b3><3b4><3b5>', '<3b2><3b3><3b4>', '', '', '', '', '<3b2><3b3><3b4><3b5><3b6>', '']
slice(-6, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '<3b1>', '<3b1><3b2>', '<3b1><3b2><3b3><3b4><3b5>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5>', '<3b1><3b2><3b3><3b4>', '<3b1>', '', '', '', '<3b1><3b2><3b3><3b4><3b5><3b6>', '']
slice(-7, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '<3b1>', '<3b1><3b2>', '<3b1><3b2><3b3><3b4><3b5>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5>', '<3b1><3b2><3b3><3b4>', '<3b1>', '', '', '', '<3b1><3b2><3b3><3b4><3b5><3b6>', '']
slice(-100, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '<3b1>', '<3b1><3b2>', '<3b1><3b2><3b3><3b4><3b5>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5>', '<3b1><3b2><3b3><3b4>', '<3b1>', '', '', '', '<3b1><3b2><3b3><3b4><3b5><3b6>', '']
slice(2147483647, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-2147483648, end) of '<3b1><3b2><3b3><3b4><3b5><3b6>' -> ['', '<3b1>', '<3b1><3b2>', '<3b1><3b2><3b3><3b4><3b5>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5><3b6>', '<3b1><3b2><3b3><3b4><3b5>', '<3b1><3b2><3b3><3b4>', '<3b1>', '', '', '', '<3b1><3b2><3b3><3b4><3b5><3b6>', '']
slice(start) of 'ab<e9>def' -> ['ab<e9>def', 'b<e9>def', '<e9>def', 'f', '', '', '', 'f', 'ef', 'b<e9>def', 'ab<e9>def', 'ab<e9>def', 'ab<e9>def', '', 'ab<e9>def']
slice(0, end) of 'ab<e9>def' -> ['', 'a', 'ab', 'ab<e9>de', 'ab<e9>def', 'ab<e9>def', 'ab<e9>def', 'ab<e9>de', 'ab<e9>d', 'a', '', '', '', 'ab<e9>def', '']
slice(1, end) of 'ab<e9>def' -> ['', '', 'b', 'b<e9>de', 'b<e9>def', 'b<e9>def', 'b<e9>def', 'b<e9>de', 'b<e9>d', '', '', '', '', 'b<e9>def', '']
slice(2, end) of 'ab<e9>def' -> ['', '', '', '<e9>de', '<e9>def', '<e9>def', '<e9>def', '<e9>de', '<e9>d', '', '', '', '', '<e9>def', '']
slice(5, end) of 'ab<e9>def' -> ['', '', '', '', 'f', 'f', 'f', '', '', '', '', '', '', 'f', '']
slice(6, end) of 'ab<e9>def' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(7, end) of 'ab<e9>def' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(100, end) of 'ab<e9>def' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-1, end) of 'ab<e9>def' -> ['', '', '', '', 'f', 'f', 'f', '', '', '', '', '', '', 'f', '']
slice(-2, end) of 'ab<e9>def' -> ['', '', '', 'e', 'ef', 'ef', 'ef', 'e', '', '', '', '', '', 'ef', '']
slice(-5, end) of 'ab<e9>def' -> ['', '', 'b', 'b<e9>de', 'b<e9>def', 'b<e9>def', 'b<e9>def', 'b<e9>de', 'b<e9>d', '', '', '', '', 'b<e9>def', '']
slice(-6, end) of 'ab<e9>def' -> ['', 'a', 'ab', 'ab<e9>de', 'ab<e9>def', 'ab<e9>def', 'ab<e9>def', 'ab<e9>de', 'ab<e9>d', 'a', '', '', '', 'ab<e9>def', '']
slice(-7, end) of 'ab<e9>def' -> ['', 'a', 'ab', 'ab<e9>de', 'ab<e9>def', 'ab<e9>def', 'ab<e9>def', 'ab<e9>de', 'ab<e9>d', 'a', '', '', '', 'ab<e9>def', '']
slice(-100, end) of 'ab<e9>def' -> ['', 'a', 'ab', 'ab<e9>de', 'ab<e9>def', 'ab<e9>def', 'ab<e9>def', 'ab<e9>de', 'ab<e9>d', 'a', '', '', '', 'ab<e9>def', '']
slice(2147483647, end) of 'ab<e9>def' -> ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
slice(-2147483648, end) of 'ab<e9>def' -> ['', 'a', 'ab', 'ab<e9>de', 'ab<e9>def', 'ab<e9>def', 'ab<e9>def', 'ab<e9>de', 'ab<e9>d', 'a', '', '', '', 'ab<e9>def', '']
slice of a rope -> 'ft0rig'
slice of a substring -> '45678'
slice of the whole string -> 'whole'
slice from a double -> 'bcdef'
slice to a double -> ''
slice from a double to 4 -> 'bcd'
slice from a negative double -> 'f'
slice to a negative double -> 'bcde'
slice from a negative double to 4 -> ''
slice from -0 -> 'abcdef'
slice to -0 -> ''
slice from -0 to 4 -> 'abcd'
slice from NaN -> 'abcdef'
slice to NaN -> ''
slice from NaN to 4 -> 'abcd'
slice from Infinity -> ''
slice to Infinity -> 'bcdef'
slice from Infinity to 4 -> ''
slice from -Infinity -> 'abcdef'
slice to -Infinity -> ''
slice from -Infinity to 4 -> 'abcd'
slice from 4294967297 -> ''
slice to 4294967297 -> 'bcdef'
slice from 4294967297 to 4 -> ''
slice from a string -> 'cdef'
slice to a string -> 'b'
slice from a string to 4 -> 'cd'
slice from text -> 'abcdef'
slice to text -> ''
slice from text to 4 -> 'abcd'
slice from true -> 'bcdef'
slice to true -> ''
slice from true to 4 -> 'bcd'
slice from null -> 'abcdef'
slice to null -> ''
slice from null to 4 -> 'abcd'
slice from undefined -> 'abcdef'
slice to undefined -> 'bcdef'
slice from undefined to 4 -> 'abcd'
slice from an object -> 'cdef'
slice to an object -> 'b'
slice from an object to 4 -> 'cd'
slice from a symbol throws TypeError: Cannot convert a symbol to a number
slice to a symbol throws TypeError: Cannot convert a symbol to a number
slice from a symbol to 4 throws TypeError: Cannot convert a symbol to a number
slice from a BigInt throws TypeError: Conversion from 'BigInt' to 'number' is not allowed.
slice to a BigInt throws TypeError: Conversion from 'BigInt' to 'number' is not allowed.
slice from a BigInt to 4 throws TypeError: Conversion from 'BigInt' to 'number' is not allowed.
slice without arguments -> 'abc'
slice with three arguments -> 'bc'
order of conversions -> ['bc', ['start', 'end']]
stringify '' -> '""'
stringify ' ' -> '" "'
stringify 'a' -> '"a"'
stringify 'A' -> '"A"'
stringify 'plain' -> '"plain"'
stringify 'Mixed Case' -> '"Mixed Case"'
stringify 'UPPER' -> '"UPPER"'
stringify ' leading' -> '" leading"'
stringify 'trailing ' -> '"trailing "'
stringify '  both  ' -> '"  both  "'
stringify '<9>tab<9>' -> '"\ttab\t"'
stringify '<a>line<a>' -> '"\nline\n"'
stringify '<d><a><b><c>' -> '"\r\n\u000b\f"'
stringify 'in ner' -> '"in ner"'
stringify '~tilde~' -> '"~tilde~"'
stringify '!bang!' -> '"!bang!"'
stringify '<7f>delete<7f>' -> '"<7f>delete<7f>"'
stringify '<a0>no-break<a0>' -> '"<a0>no-break<a0>"'
stringify '<c0><c9><d6> LATIN' -> '"<c0><c9><d6> LATIN"'
stringify '<df> sharp' -> '"<df> sharp"'
stringify '<ff>' -> '"<ff>"'
stringify '<feff>mark<feff>' -> '"<feff>mark<feff>"'
stringify '<2003>em<2003>' -> '"<2003>em<2003>"'
stringify '<180e>mongolian<180e>' -> '"<180e>mongolian<180e>"'
stringify '<130> DOTTED' -> '"<130> DOTTED"'
stringify '<3a3><391><3a3>' -> '"<3a3><391><3a3>"'
stringify '<d801><dc00> DESERET' -> '"<d801><dc00> DESERET"'
stringify '<d800> lone' -> '"\ud800 lone"'
stringify '0123456789abcdef0123456789ABCDEF' -> '"0123456789abcdef0123456789ABCDEF"'
stringify 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxY' -> '"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxY"'
stringify '"' -> '"\""'
stringify '\' -> '"\\"'
stringify 'say "hi"' -> '"say \"hi\""'
stringify 'back\slash' -> '"back\\slash"'
stringify '<8><c><a><d><9>' -> '"\b\f\n\r\t"'
stringify '<0><1><1f>' -> '"\u0000\u0001\u001f"'
stringify '/slash/' -> '"/slash/"'
stringify '0123456789abcde"' -> '"0123456789abcde\""'
stringify '0123456789abcdef<a>' -> '"0123456789abcdef\n"'
stringify '0123456789abcdef0123456789abcde\' -> '"0123456789abcdef0123456789abcde\\"'
stringify 'abc"' -> '"abc\""'
stringify 'abcdefg<a>' -> '"abcdefg\n"'
stringify '<2028><2029>' -> '"<2028><2029>"'
stringify '<d83d><de00>' -> '"<d83d><de00>"'
stringify '<dc00><d800>' -> '"\udc00\ud800"'
stringify 'a<d800>' -> '"a\ud800"'
stringify '<dfff>z' -> '"\udfffz"'
stringify a text of length 9000 that ends with 'q' -> [9002, '"qq', 'qq"', true]
stringify a text of length 9001 that ends with '"' -> [9004, '"qq', '\""', true]
stringify a text of length 9000 that ends with '<3c0>' -> [9002, '"<3c0><3c0>', '<3c0><3c0>"', true]
stringify a rope -> '"left0ri\"ght"'
stringify a rope without escapes -> '"left0right"'
stringify a substring -> '"2345678"'
stringify 0 -> '0'
stringify -0 -> '0'
stringify 1 -> '1'
stringify -1 -> '-1'
stringify 9 -> '9'
stringify 10 -> '10'
stringify 255 -> '255'
stringify 256 -> '256'
stringify 65536 -> '65536'
stringify 2147483647 -> '2147483647'
stringify -2147483648 -> '-2147483648'
stringify 2147483648 -> '2147483648'
stringify -2147483649 -> '-2147483649'
stringify 4294967296 -> '4294967296'
stringify 9007199254740991 -> '9007199254740991'
stringify 9007199254740992 -> '9007199254740992'
stringify 0.1 -> '0.1'
stringify -0.5 -> '-0.5'
stringify 1.5 -> '1.5'
stringify 123.456 -> '123.456'
stringify 1e+21 -> '1e+21'
stringify 1e-7 -> '1e-7'
stringify 1.7976931348623157e+308 -> '1.7976931348623157e+308'
stringify 5e-324 -> '5e-324'
stringify NaN -> 'null'
stringify Infinity -> 'null'
stringify -Infinity -> 'null'
stringify many numbers -> '99024.75'
stringify true -> 'true'
stringify false -> 'false'
stringify null -> 'null'
stringify undefined -> undefined
stringify a symbol -> undefined
stringify a function -> undefined
stringify a BigInt throws TypeError: JSON.stringify cannot serialize BigInt.
stringify an object -> '{"a":[1,"two",null]}'
stringify an array -> '[null,null,null]'
stringify a String object -> '"q\""'
stringify a Number object -> '1.5'
stringify a Boolean object -> 'false'
stringify an object with toJSON -> '"from toJSON"'
stringify a Date -> '"1970-01-01T00:00:00.000Z"'
stringify a Map -> '{}'
stringify a cycle throws TypeError: JSON.stringify cannot serialize cyclic structures.
stringify without an argument -> undefined
stringify a string with a replacer -> '"a!"'
stringify a number with a replacer -> '"replaced"'
stringify a string with null and an indent -> '"a"'
stringify with a receiver -> '"a"'
stringify a BigInt with toJSON -> '"big 7"'
other realm stringify -> ['"a\""', '1.5', 'null', undefined]
other realm stringify of a BigInt throws TypeError: JSON.stringify cannot serialize BigInt.
results are strings -> ['string', 'string', 'string', 'string', 'undefined']
*/
