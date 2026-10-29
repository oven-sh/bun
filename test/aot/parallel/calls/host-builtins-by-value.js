// Host functions and internal functions called by value: the guarded stubs of built-ins answer as the host functions do, for every receiver and argument that fails a guard too.
// The output is stored: an executable leaves out the `(evaluating '..')` that plain Bun adds to some messages.
import "../../fixtures/jsc-shell-functions.ts";

const iterations = 100;

// The frames of the program's own functions. Compiled code reaches some built-ins without a frame of the host, and a stack trace then has no line for them.
function frames(error) {
  const list = [];
  for (const line of String(error.stack).split("\n")) {
    const frame = /^\s*at (?:new )?(.*?) \((.*)\)$/.exec(line) ?? /^(.*?)@(.*)$/.exec(line);
    if (!frame) continue;
    const [, name, location] = frame;
    const lineNumber = /:(\d+):\d+$/.exec(location)?.[1];
    if (lineNumber === undefined || location.startsWith("native")) continue;
    list.push(name + ":" + lineNumber);
    if (name === "attempt") break;
  }
  return list.join(" < ");
}

function show(value) {
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (value instanceof Date) return "Date " + value.getTime();
  if (value instanceof Error) return value.name + ": " + value.message;
  if (Array.isArray(value)) return "[" + Array.prototype.map.call(value, show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  if (typeof value === "string") return JSON.stringify(value);
  return Object.is(value, -0) ? "-0" : String(value);
}

function attempt(label, action) {
  try {
    console.log(label, "->", show(action()));
  } catch (error) {
    console.log(label, "throws", error.name + ": " + error.message);
    console.log("  stack", frames(error));
  }
}

function repeat(label, action) {
  let result;
  for (let i = 0; i < iterations; ++i) result = action(i);
  console.log(label, "->", show(result));
}

const get = (receiver, key) => receiver.get(key);
const has = (receiver, key) => receiver.has(key);
const set = (receiver, key, value) => receiver.set(key, value);
const add = (receiver, key) => receiver.add(key);
const startsWith = (receiver, text) => receiver.startsWith(text);
const indexOf = (receiver, text) => receiver.indexOf(text);
const push = (receiver, value) => receiver.push(value);
const slice1 = (receiver, start) => receiver.slice(start);
const slice2 = (receiver, start, end) => receiver.slice(start, end);
const isArray = Array.isArray;

class M extends Map {}
class S extends Set {}
class A extends Array {}

const withProperty = new Map();
withProperty.extra = 1;

for (const [name, map] of [["Map", new Map()], ["subclass", new M()], ["added property", withProperty]]) {
  repeat(name + " set", i => set(map, i % 7, i).size);
  repeat(name + " get", i => get(map, i % 7));
  repeat(name + " has", i => has(map, i % 9));
  attempt(name + " string key", () => get(set(map, "k" + 1, "v"), "k1"));
  attempt(name + " double key", () => get(set(map, 1.5, "d"), 1.5));
  attempt(name + " NaN key", () => get(set(map, NaN, "n"), NaN));
  attempt(name + " -0 key", () => get(set(map, -0, "z"), 0));
}

for (const [name, values] of [["Set", new Set()], ["subclass", new S()]]) {
  repeat(name + " add", i => add(values, i % 5).size);
  repeat(name + " has", i => has(values, i % 8));
}

{
  const keys = [{}, [], function () {}];
  const weakMap = new WeakMap();
  const weakSet = new WeakSet([keys[0]]);
  repeat("WeakMap set", i => set(weakMap, keys[i % 2], i) === weakMap);
  repeat("WeakMap get", i => get(weakMap, keys[i % 2]));
  repeat("WeakMap has", i => has(weakMap, keys[i % 3]));
  repeat("WeakSet has", i => has(weakSet, keys[i % 2]));
  attempt("WeakMap get of a number", () => get(weakMap, 1));
  attempt("WeakMap has of a number", () => has(weakMap, 1));
  attempt("WeakSet has of a number", () => has(weakSet, 1));
}

repeat("startsWith", i => startsWith("prefix" + (i % 3), "pre"));
repeat("startsWith absent", i => startsWith("prefix" + (i % 3), "fix"));
repeat("indexOf", i => indexOf("abcabc" + (i % 3), "ca"));
repeat("indexOf absent", i => indexOf("abcabc" + (i % 3), "zz"));

repeat("isArray", i => [isArray([]), isArray(new A()), isArray({}), isArray(i), isArray("s"), isArray(null)]);
attempt("isArray of a Proxy of an object", () => isArray(new Proxy({}, {})));

for (const [name, create] of [["Array", () => [1, 2, 3, 4, 5]], ["subclass", () => A.from([1, 2, 3, 4, 5])], ["doubles", () => [1.5, 2.5, 3.5, 4.5]], ["strings", () => ["a", "b", "c", "d"]]]) {
  repeat(name + " push", i => {
    const array = create();
    push(array, i);
    push(array, "mixed");
    return array.length;
  });
  const array = create();
  repeat(name + " slice(1)", () => slice1(array, 1));
  repeat(name + " slice(1, 3)", () => slice2(array, 1, 3));
  repeat(name + " slice(-2)", () => slice1(array, -2));
  attempt(name + " slice class", () => slice1(array, 1).constructor.name);
}

const call0 = f => f();
const call1 = (f, a) => f(a);
const call2 = (f, a, b) => f(a, b);
const call3 = (f, a, b, c) => f(a, b, c);
const new0 = f => new f();
const new1 = (f, a) => new f(a);
const new2 = (f, a, b) => new f(a, b);
const new3 = (f, a, b, c) => new f(a, b, c);

for (const internal of [String, Number, Boolean, Array, Object, Symbol]) {
  attempt(internal.name + "()", () => call0(internal));
  attempt(internal.name + "(7)", () => call1(internal, 7));
  attempt(internal.name + "(7, 8)", () => call2(internal, 7, 8));
  attempt(internal.name + "(7, 8, 9)", () => call3(internal, 7, 8, 9));
}
attempt("Date()", () => typeof call0(Date));
attempt("Date(7)", () => typeof call1(Date, 7));
attempt("Date(7, 8)", () => typeof call2(Date, 7, 8));
attempt("Date(7, 8, 9)", () => typeof call3(Date, 7, 8, 9));

attempt("new Date()", () => new0(Date) instanceof Date);
attempt("new Date(7)", () => new1(Date, 7));
attempt("new Date(2000, 1)", () => new2(Date, 2000, 1).getMonth());
attempt("new Date(2000, 1, 2)", () => new3(Date, 2000, 1, 2).getDate());
attempt("new Array()", () => new0(Array));
attempt("new Array(2)", () => new1(Array, 2).length);
attempt("new Array(1, 2)", () => new2(Array, 1, 2));
attempt("new Array(1, 2, 3)", () => new3(Array, 1, 2, 3));
attempt("new Array(-1)", () => new1(Array, -1));
attempt("new Map()", () => new0(Map).size);
attempt("new Map(entries)", () => new1(Map, [[1, 2]]).get(1));
attempt("new Error()", () => new0(Error));
attempt("new Error(text)", () => new1(Error, "text"));
attempt("new Error(text, options)", () => new2(Error, "text", { cause: 1 }).cause);
attempt("new Symbol()", () => new0(Symbol));

const weakMap = new WeakMap();
const mapGet = Map.prototype.get;
attempt("Map get on a Set", () => mapGet.call(new Set(), 1));
attempt("Map get on a number", () => mapGet.call(1, 1));
attempt("Map get by value on a Set", () => call1(mapGet.bind(new Set()), 1));
attempt("WeakMap set of a number", () => set(weakMap, 1, 1));
attempt("WeakMap set of a symbol", () => set(weakMap, Symbol(), 1) === weakMap);
attempt("startsWith of a RegExp", () => startsWith("a", /a/));
attempt("indexOf of a number", () => indexOf("a1", 1));
attempt("isArray of a Proxy", () => isArray(new Proxy([], {})));
attempt("isArray of a revoked Proxy", () => {
  const { proxy, revoke } = Proxy.revocable([], {});
  revoke();
  return isArray(proxy);
});
attempt("push on a frozen array", () => push(Object.freeze([1]), 2));
attempt("push on an array-like", () => {
  const list = { length: 0 };
  const result = Array.prototype.push.call(list, 1);
  return [result, list.length, list[0]];
});
attempt("slice of a string", () => slice1([1, 2, 3], "1"));
attempt("slice of a double", () => slice1([1, 2, 3], 1.5));

const other = createGlobalObject();
const otherMap = new other.Map([[1, 2]]);
attempt("other realm Map get", () => other.Map.prototype.get.call(otherMap, 1));
attempt("other realm Map get by method", () => get(otherMap, 1));
attempt("other realm Map get on this realm's Map", () => other.Map.prototype.get.call(new Map([[1, 3]]), 1));
attempt("other realm Map get on a Set", () => other.Map.prototype.get.call(new Set(), 1));
attempt("other realm WeakMap set of a number", () => other.WeakMap.prototype.set.call(new other.WeakMap(), 1, 1));
attempt("other realm startsWith", () => other.String.prototype.startsWith.call("abc", "a"));
attempt("other realm startsWith of a RegExp", () => other.String.prototype.startsWith.call("abc", /a/));
attempt("other realm indexOf", () => other.String.prototype.indexOf.call("abc", "c"));
attempt("other realm isArray", () => [other.Array.isArray([]), other.Array.isArray(new other.Array()), isArray(new other.Array())]);
attempt("other realm push", () => {
  const array = [1];
  return [other.Array.prototype.push.call(array, 2), array];
});
attempt("other realm push on its own array", () => push(new other.Array(), 1));
attempt("other realm slice", () => {
  const result = other.Array.prototype.slice.call([1, 2, 3], 1);
  return [result, result instanceof Array, result instanceof other.Array];
});
attempt("other realm slice of its own array", () => {
  const result = slice2(new other.Array(1, 2, 3), 1, 2);
  return [result, result instanceof Array, result instanceof other.Array];
});
attempt("other realm push on a frozen array", () => other.Array.prototype.push.call(Object.freeze([1]), 2));
/* Output:
Map set -> 7
Map get -> 99
Map has -> true
Map string key -> "v"
Map double key -> "d"
Map NaN key -> "n"
Map -0 key -> "z"
subclass set -> 7
subclass get -> 99
subclass has -> true
subclass string key -> "v"
subclass double key -> "d"
subclass NaN key -> "n"
subclass -0 key -> "z"
added property set -> 7
added property get -> 99
added property has -> true
added property string key -> "v"
added property double key -> "d"
added property NaN key -> "n"
added property -0 key -> "z"
Set add -> 5
Set has -> true
subclass add -> 5
subclass has -> true
WeakMap set -> true
WeakMap get -> 99
WeakMap has -> true
WeakSet has -> false
WeakMap get of a number -> undefined
WeakMap has of a number -> false
WeakSet has of a number -> false
startsWith -> true
startsWith absent -> false
indexOf -> 2
indexOf absent -> -1
isArray -> [true, true, false, false, false, false]
isArray of a Proxy of an object -> false
Array push -> 7
Array slice(1) -> [2, 3, 4, 5]
Array slice(1, 3) -> [2, 3]
Array slice(-2) -> [4, 5]
Array slice class -> "Array"
subclass push -> 7
subclass slice(1) -> [2, 3, 4, 5]
subclass slice(1, 3) -> [2, 3]
subclass slice(-2) -> [4, 5]
subclass slice class -> "A"
doubles push -> 6
doubles slice(1) -> [2.5, 3.5, 4.5]
doubles slice(1, 3) -> [2.5, 3.5]
doubles slice(-2) -> [3.5, 4.5]
doubles slice class -> "Array"
strings push -> 6
strings slice(1) -> ["b", "c", "d"]
strings slice(1, 3) -> ["b", "c"]
strings slice(-2) -> ["c", "d"]
strings slice class -> "Array"
String() -> ""
String(7) -> "7"
String(7, 8) -> "7"
String(7, 8, 9) -> "7"
Number() -> 0
Number(7) -> 7
Number(7, 8) -> 7
Number(7, 8, 9) -> 7
Boolean() -> false
Boolean(7) -> true
Boolean(7, 8) -> true
Boolean(7, 8, 9) -> true
Array() -> []
Array(7) -> [, , , , , , ]
Array(7, 8) -> [7, 8]
Array(7, 8, 9) -> [7, 8, 9]
Object() -> [object Object]
Object(7) -> [object Number]
Object(7, 8) -> [object Number]
Object(7, 8, 9) -> [object Number]
Symbol() -> Symbol()
Symbol(7) -> Symbol(7)
Symbol(7, 8) -> Symbol(7)
Symbol(7, 8, 9) -> Symbol(7)
Date() -> "string"
Date(7) -> "string"
Date(7, 8) -> "string"
Date(7, 8, 9) -> "string"
new Date() -> true
new Date(7) -> Date 7
new Date(2000, 1) -> 1
new Date(2000, 1, 2) -> 2
new Array() -> []
new Array(2) -> 2
new Array(1, 2) -> [1, 2]
new Array(1, 2, 3) -> [1, 2, 3]
new Array(-1) throws RangeError: Array length must be a positive integer of safe magnitude.
  stack new1:121 < attempt:35
new Map() -> 0
new Map(entries) -> 2
new Error() -> Error: 
new Error(text) -> Error: text
new Error(text, options) -> 1
new Symbol() throws TypeError: function is not a constructor (evaluating 'new f')
  stack new0:120 < attempt:35
Map get on a Set throws TypeError: Map operation called on non-Map object
  stack attempt:35
Map get on a number throws TypeError: 1 is not an object
  stack attempt:35
Map get by value on a Set throws TypeError: Map operation called on non-Map object
  stack attempt:35
WeakMap set of a number throws TypeError: WeakMap keys must be objects or non-registered symbols
  stack attempt:35
WeakMap set of a symbol -> true
startsWith of a RegExp throws TypeError: Argument to String.prototype.startsWith cannot be a RegExp
  stack attempt:35
indexOf of a number -> 1
isArray of a Proxy -> true
isArray of a revoked Proxy throws TypeError: Array.isArray cannot be called on a Proxy that has been revoked
  stack attempt:35
push on a frozen array throws TypeError: Attempted to assign to readonly property.
  stack attempt:35
push on an array-like -> [1, 1, 1]
slice of a string -> [2, 3]
slice of a double -> [2, 3]
other realm Map get -> 2
other realm Map get by method -> 2
other realm Map get on this realm's Map -> 3
other realm Map get on a Set throws TypeError: Map operation called on non-Map object
  stack attempt:35
other realm WeakMap set of a number throws TypeError: WeakMap keys must be objects or non-registered symbols
  stack attempt:35
other realm startsWith -> true
other realm startsWith of a RegExp throws TypeError: Argument to String.prototype.startsWith cannot be a RegExp
  stack attempt:35
other realm indexOf -> 2
other realm isArray -> [true, true, true]
other realm push -> [2, [1, 2]]
other realm push on its own array -> 1
other realm slice -> [[2, 3], false, true]
other realm slice of its own array -> [[2], false, true]
other realm push on a frozen array throws TypeError: Attempted to assign to readonly property.
  stack attempt:35
*/
