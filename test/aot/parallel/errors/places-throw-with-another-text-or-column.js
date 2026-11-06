// The places that throw where the message, a column, the name of a frame or a frame of a built-in is not that of plain Bun: see docs/compiler/compatibility.mdx#error-messages, #function-names-from-local-variables and docs/compiler/debugging.mdx#stack-traces. The class and the line are the same.
"use strict";
const opaque = value => [value, 0][Number(process.argv.length > 100)];
function framesOf(stack, count) {
  const frames = [];
  for (const text of String(stack).split("\n")) {
    const frame = /^\s*at (?:(async )?(.*?) \()?([^()]*?)(?::(\d+):(\d+))?\)?$/.exec(text);
    if (!frame) continue;
    const file = frame[3].replace(/^.*[\\/]/, "");
    frames.push((frame[1] ?? "") + (frame[2] ?? "") + "@" + file + (frame[4] ? ":" + frame[4] + ":" + frame[5] : ""));
  }
  return frames.slice(0, count).join(" | ");
}
function describe(error) {
  if (!(error instanceof Error)) return "no error: " + String(error);
  return error.name + ": " + error.message + " [" + error.line + ":" + error.column + "] " + framesOf(error.stack, 3);
}
function attempt(label, run) {
  try {
    console.log(label, "-> no throw", String(run()));
  } catch (error) {
    console.log(label, "->", describe(error));
  }
}
const nothing = opaque(undefined), none = opaque(null), five = opaque(5), text = opaque("abc"), plain = opaque({}), list = opaque([1, 2]);
const holder = opaque({ inner: null, missing: undefined, number: 5, deep: { inner: null }, list: [null], run: 5 });
const key = opaque("name"), index = opaque(0);
function thrower() { throw new Error("thrown behind a tail call"); }
const throwing = { method() { throw new Error("thrown in a method behind a tail call"); } };

// Calls of what is no function.
attempt("call string variable", () => { text(); });
attempt("call object variable", () => { plain(); });
attempt("call with arguments", () => { holder.absent(1, "two", [3]); });
attempt("call of a call", () => { (() => 5)()(); });
attempt("call spread", () => { holder.absent(...list); });
attempt("call tagged template", () => { holder.absent`x`; });
attempt("call via call", () => { holder.absent.call(null); });
attempt("new arrow", () => { new (() => 1)(); });
attempt("new method", () => { new ({ m() {} }).m(); });
attempt("new Symbol", () => { new Symbol(); });
attempt("new async function", () => { new (async function named() {})(); });
attempt("new generator", () => { new (function* named() {})(); });

// Reads of null and undefined.
attempt("read of undefined", () => { nothing.name; });
attempt("read of null", () => { none.name; });
attempt("read member", () => { holder.inner.name; });
attempt("read member undefined", () => { holder.missing.name; });
attempt("read deep member", () => { holder.deep.inner.name; });
attempt("read computed", () => { holder.inner[key]; });
attempt("read indexed", () => { holder.inner[index]; });
attempt("read of element", () => { holder.list[0].name; });
attempt("read of computed holder", () => { holder[key].name; });
attempt("read of call", () => { (() => null)().name; });
attempt("read optional chain tail", () => { holder.deep?.inner.name; });
attempt("read length", () => { holder.inner.length; });
attempt("read then call", () => { holder.inner.run(); });
attempt("read then call computed", () => { holder.inner[key](); });
attempt("read in a sum", () => { 1 + holder.inner.name; });
attempt("read in a condition", () => { (holder.inner.name ? 1 : 2); });
attempt("read typeof", () => { typeof holder.inner.name; });
attempt("read private of other", () => { class A { #p = 1; static read(o) { return o.#p; } } return A.read(plain); });
attempt("read this undefined", function () { return (function () { return this.name; })(); });

// Stores to null and undefined.
attempt("store member", () => { holder.inner.name = 1; });
attempt("store undefined member", () => { holder.missing.name = 1; });
attempt("store computed", () => { holder.inner[key] = 1; });
attempt("store indexed", () => { holder.inner[index] = 1; });
attempt("store compound", () => { holder.inner.name += 1; });
attempt("store increment", () => { holder.inner.name++; });
attempt("store prefix decrement", () => { --holder.inner.name; });
attempt("store logical", () => { holder.inner.name ??= 1; });
attempt("store compound computed", () => { holder.inner[key] += 1; });
attempt("delete member", () => { delete holder.inner.name; });
attempt("delete computed", () => { delete holder.inner[key]; });

// Destructuring.
attempt("destructure nested", () => { const { inner: { a } } = holder; return a; });
attempt("destructure nested undefined", () => { const { missing: { a } } = holder; return a; });
attempt("destructure array of undefined", () => { const [a] = nothing; return a; });
attempt("destructure array of number", () => { const [a] = five; return a; });
attempt("destructure array of object", () => { const [a] = plain; return a; });
attempt("destructure nested array", () => { const { number: [a] } = holder; return a; });
attempt("destructure parameter", () => { (({ a }) => a)(nothing); });
attempt("destructure parameter nested", () => { (({ inner: { a } }) => a)(holder); });
attempt("destructure array parameter", () => { (([a]) => a)(nothing); });
attempt("destructure default throws", () => { const { a = holder.inner.name } = plain; return a; });
attempt("destructure computed key", () => { const { [holder.inner.name]: a } = plain; return a; });
attempt("destructure assignment target", () => { ({ a: holder.inner.name } = { a: 1 }); });
attempt("destructure in for-of", () => { for (const { a } of [null]) return a; });
attempt("destructure in catch", () => { try { throw null; } catch ({ a }) { return a; } });
attempt("destructure second of two", () => { const { number, inner: { a } } = holder; return a + number; });
attempt("destructure getter throws", () => { const { a } = { get a() { throw new Error("getter"); } }; return a; });
attempt("destructure iterator throws", () => { const [a] = { [Symbol.iterator]() { throw new Error("iterator"); } }; return a; });
attempt("destructure next throws", () => { const [a] = { [Symbol.iterator]() { return { next() { throw new Error("next"); } }; } }; return a; });

// Iteration.
attempt("for-of undefined", () => { for (const x of nothing) return x; });
attempt("yield star", () => { [...(function* () { yield* five; })()]; });
attempt("iterator no next", () => { for (const x of { [Symbol.iterator]() { return {}; } }) return x; });

// Variables.
attempt("dead zone let", () => { const read = () => later; read(); let later = 1; });
attempt("dead zone const", () => { const read = () => later; read(); const later = 1; });
attempt("dead zone class", () => { const read = () => Later; read(); class Later {} });
attempt("dead zone store", () => { const write = () => { later = 2; }; write(); let later = 1; });

// Operators.
attempt("in number", () => { "a" in five; });
attempt("in undefined", () => { "a" in nothing; });
attempt("in member", () => { key in holder.inner; });
attempt("in string", () => { "length" in text; });
attempt("private in number", () => { class A { #p; static has(o) { return #p in o; } } return A.has(five); });
attempt("instanceof object", () => { plain instanceof opaque(plain); });
attempt("instanceof arrow", () => { plain instanceof (() => 1); });
attempt("instanceof hasInstance 5", () => { plain instanceof { [Symbol.hasInstance]: 5 }; });
attempt("bigint Math", () => { Math.max(opaque(1n)); });

// Classes.
attempt("class without new", () => { class A {} return A(); });
attempt("class member without new", () => { const o = { A: class {} }; return o.A(); });
attempt("no super", () => { class A {} class B extends A { constructor() {} } return new B(); });
attempt("derived returns number", () => { class A {} class B extends A { constructor() { super(); return 5; } } return new B(); });
attempt("extends number", () => { class B extends five {} return B; });
attempt("extends undefined", () => { class B extends nothing {} return B; });
attempt("extends member", () => { class B extends holder.inner2 {} return B; });
attempt("extends arrow", () => { class B extends (() => 1) {} return B; });
attempt("extends bad prototype", () => { function F() {} F.prototype = 5; class B extends F {} return B; });
attempt("extends null new", () => { class B extends null {} return new B(); });
attempt("extends generator", () => { class B extends (function* () {}) {} return B; });
attempt("super member of null", () => { class A {} class B extends A { run() { return super.absent.name; } } return new B().run(); });
attempt("private method of other", () => { class A { #m() {} static run(o) { return o.#m(); } } return A.run(plain); });
attempt("private store of other", () => { class A { #p = 1; static write(o) { o.#p = 2; } } return A.write(plain); });
attempt("private twice", () => { class Base { constructor(o) { return o; } } class A extends Base { #p = 1; } const o = {}; new A(o); return new A(o); });
attempt("static prototype", () => { class A { static ["prototype"]() {} } return A; });

// Objects that refuse.
attempt("frozen array push", () => { Object.freeze(opaque([1])).push(2); });
attempt("not extensible index", () => { Object.preventExtensions(opaque({}))[0] = 2; });
attempt("not configurable accessor", () => { Object.defineProperty(Object.defineProperty(opaque({}), "a", { value: 1 }), "a", { get() {} }); });
attempt("function name store strict", () => { (function f() {}).name = "g"; });
attempt("create number", () => { Object.create(five); });

// Ranges.
attempt("new Array -1", () => { new Array(opaque(-1)); });
attempt("new Array fraction", () => { new Array(opaque(1.5)); });
attempt("Array call -1", () => { Array(opaque(-1)); });

// Text that is parsed.
attempt("JSON circular deep", () => { const o = { a: { b: [] } }; o.a.b.push(o); return JSON.stringify(o); });
attempt("replaceAll not global", () => { text.replaceAll(/a/, "b"); });

// Receivers and arguments that built-ins refuse.
attempt("Promise without new", () => { Promise(() => {}); });
attempt("Proxy ownKeys", () => { Object.keys(new Proxy({}, { ownKeys: () => [1] })); });
attempt("Object.keys undefined", () => { Object.keys(nothing); });
attempt("hasOwn undefined", () => { Object.hasOwn(nothing, "a"); });
attempt("apply list", () => { (() => 1).apply(null, five); });
attempt("structuredClone function", () => { structuredClone(() => 1); });
attempt("structuredClone symbol", () => { structuredClone(Symbol()); });
attempt("Intl receiver", () => { Intl.NumberFormat.prototype.format.call(plain); });

// The same in the position of a tail call: strict code leaves its frame before such a call.
attempt("tail call native", () => Math.max(opaque(1n)));
/* Output:
call string variable -> TypeError: text is not a function. (In 'text()', 'text' is "abc") [32:41] <anonymous>@places-throw-with-another-text-or-column.js:32:41 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:32:1
call object variable -> TypeError: plain is not a function. (In 'plain()', 'plain' is an instance of Object) [33:41] <anonymous>@places-throw-with-another-text-or-column.js:33:41 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:33:1
call with arguments -> TypeError: holder.absent is not a function. (In 'holder.absent()', 'holder.absent' is undefined) [34:47] <anonymous>@places-throw-with-another-text-or-column.js:34:47 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:34:1
call of a call -> TypeError: 5 is not a function [35:45] <anonymous>@places-throw-with-another-text-or-column.js:35:45 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:35:1
call spread -> TypeError: holder.absent is not a function. (In 'holder.absent()', 'holder.absent' is undefined) [36:39] <anonymous>@places-throw-with-another-text-or-column.js:36:39 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:36:1
call tagged template -> TypeError: holder.absent is not a function. (In 'holder.absent()', 'holder.absent' is undefined) [37:48] <anonymous>@places-throw-with-another-text-or-column.js:37:48 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:37:1
call via call -> TypeError: undefined is not an object (evaluating 'undefined.call') [38:41] <anonymous>@places-throw-with-another-text-or-column.js:38:41 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:38:1
new arrow -> TypeError: function is not a constructor [39:30] <anonymous>@places-throw-with-another-text-or-column.js:39:30 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:39:1
new method -> TypeError: function is not a constructor (evaluating 'new m') [40:31] <anonymous>@places-throw-with-another-text-or-column.js:40:31 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:40:1
new Symbol -> TypeError: function is not a constructor (evaluating 'new Symbol') [41:31] Symbol@unknown | <anonymous>@places-throw-with-another-text-or-column.js:41:31 | attempt@places-throw-with-another-text-or-column.js:20:46
new async function -> TypeError: function is not a constructor [42:39] <anonymous>@places-throw-with-another-text-or-column.js:42:39 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:42:1
new generator -> TypeError: function is not a constructor [43:34] <anonymous>@places-throw-with-another-text-or-column.js:43:34 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:43:1
read of undefined -> TypeError: undefined is not an object (evaluating 'undefined.name') [46:38] <anonymous>@places-throw-with-another-text-or-column.js:46:38 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:46:1
read of null -> TypeError: null is not an object (evaluating 'null.name') [47:33] <anonymous>@places-throw-with-another-text-or-column.js:47:33 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:47:1
read member -> TypeError: null is not an object (evaluating 'null.name') [48:39] <anonymous>@places-throw-with-another-text-or-column.js:48:39 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:48:1
read member undefined -> TypeError: undefined is not an object (evaluating 'undefined.name') [49:49] <anonymous>@places-throw-with-another-text-or-column.js:49:49 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:49:1
read deep member -> TypeError: null is not an object (evaluating 'null.name') [50:49] <anonymous>@places-throw-with-another-text-or-column.js:50:49 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:50:1
read computed -> TypeError: null is not an object (evaluating 'null["name"]') [51:41] <anonymous>@places-throw-with-another-text-or-column.js:51:41 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:51:1
read indexed -> TypeError: null is not an object (evaluating 'null[0]') [52:40] <anonymous>@places-throw-with-another-text-or-column.js:52:40 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:52:1
read of element -> TypeError: null is not an object (evaluating 'null.name') [53:48] <anonymous>@places-throw-with-another-text-or-column.js:53:48 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:53:1
read of computed holder -> TypeError: undefined is not an object (evaluating 'undefined.name') [54:51] <anonymous>@places-throw-with-another-text-or-column.js:54:51 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:54:1
read of call -> TypeError: null is not an object (evaluating 'null.name') [55:46] <anonymous>@places-throw-with-another-text-or-column.js:55:46 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:55:1
read optional chain tail -> TypeError: null is not an object (evaluating 'null.name') [56:58] <anonymous>@places-throw-with-another-text-or-column.js:56:58 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:56:1
read length -> TypeError: null is not an object (evaluating 'null.length') [57:39] <anonymous>@places-throw-with-another-text-or-column.js:57:39 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:57:1
read then call -> TypeError: null is not an object (evaluating 'null.run') [58:42] <anonymous>@places-throw-with-another-text-or-column.js:58:42 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:58:1
read then call computed -> TypeError: null is not an object (evaluating 'null["name"]') [59:51] <anonymous>@places-throw-with-another-text-or-column.js:59:51 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:59:1
read in a sum -> TypeError: null is not an object (evaluating 'null.name') [60:45] <anonymous>@places-throw-with-another-text-or-column.js:60:45 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:60:1
read in a condition -> TypeError: null is not an object (evaluating 'null.name') [61:48] <anonymous>@places-throw-with-another-text-or-column.js:61:48 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:61:1
read typeof -> TypeError: null is not an object (evaluating 'null.name') [62:46] <anonymous>@places-throw-with-another-text-or-column.js:62:46 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:62:1
read private of other -> TypeError: Cannot access invalid private field [63:84] read@places-throw-with-another-text-or-column.js:63:84 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:63:1
read this undefined -> TypeError: undefined is not an object (evaluating 'undefined.name') [64:75] <anonymous>@places-throw-with-another-text-or-column.js:64:75 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:64:1
store member -> TypeError: null is not an object (evaluating 'null.name') [67:40] <anonymous>@places-throw-with-another-text-or-column.js:67:40 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:67:1
store undefined member -> TypeError: undefined is not an object (evaluating 'undefined.name') [68:50] <anonymous>@places-throw-with-another-text-or-column.js:68:50 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:68:1
store computed -> TypeError: null is not an object (evaluating 'null["name"]') [69:42] <anonymous>@places-throw-with-another-text-or-column.js:69:42 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:69:1
store indexed -> TypeError: null is not an object (evaluating 'null[0]') [70:41] <anonymous>@places-throw-with-another-text-or-column.js:70:41 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:70:1
store compound -> TypeError: null is not an object (evaluating 'null.name') [71:42] <anonymous>@places-throw-with-another-text-or-column.js:71:42 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:71:1
store increment -> TypeError: null is not an object (evaluating 'null.name') [72:43] <anonymous>@places-throw-with-another-text-or-column.js:72:43 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:72:1
store prefix decrement -> TypeError: null is not an object (evaluating 'null.name') [73:52] <anonymous>@places-throw-with-another-text-or-column.js:73:52 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:73:1
store logical -> TypeError: null is not an object (evaluating 'null.name') [74:41] <anonymous>@places-throw-with-another-text-or-column.js:74:41 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:74:1
store compound computed -> TypeError: Cannot access property of undefined or null [75:57] <anonymous>@places-throw-with-another-text-or-column.js:75:57 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:75:1
delete member -> TypeError: null is not an object [76:54] <anonymous>@places-throw-with-another-text-or-column.js:76:54 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:76:1
delete computed -> TypeError: null is not an object [77:56] <anonymous>@places-throw-with-another-text-or-column.js:77:56 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:77:1
destructure nested -> TypeError: Cannot destructure property 'a' from null or undefined value [80:64] <anonymous>@places-throw-with-another-text-or-column.js:80:64 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:80:1
destructure nested undefined -> TypeError: Cannot destructure property 'a' from null or undefined value [81:76] <anonymous>@places-throw-with-another-text-or-column.js:81:76 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:81:1
destructure array of undefined -> TypeError: undefined is not an object [82:51] <anonymous>@places-throw-with-another-text-or-column.js:82:51 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:82:1
destructure array of number -> TypeError: number is not iterable [83:48] <anonymous>@places-throw-with-another-text-or-column.js:83:48 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:83:1
destructure array of object -> TypeError: {} is not iterable [84:48] <anonymous>@places-throw-with-another-text-or-column.js:84:48 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:84:1
destructure nested array -> TypeError: number is not iterable [85:53] <anonymous>@places-throw-with-another-text-or-column.js:85:53 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:85:1
destructure parameter -> TypeError: Cannot destructure property 'a' from null or undefined value [86:54] <anonymous>@places-throw-with-another-text-or-column.js:86:54 | <anonymous>@places-throw-with-another-text-or-column.js:86:54 | attempt@places-throw-with-another-text-or-column.js:20:46
destructure parameter nested -> TypeError: Cannot destructure property 'a' from null or undefined value [87:72] <anonymous>@places-throw-with-another-text-or-column.js:87:72 | <anonymous>@places-throw-with-another-text-or-column.js:87:72 | attempt@places-throw-with-another-text-or-column.js:20:46
destructure array parameter -> TypeError: undefined is not an object [88:49] <anonymous>@places-throw-with-another-text-or-column.js:88:49 | <anonymous>@places-throw-with-another-text-or-column.js:88:58 | attempt@places-throw-with-another-text-or-column.js:20:46
destructure default throws -> TypeError: null is not an object (evaluating 'null.name') [89:66] <anonymous>@places-throw-with-another-text-or-column.js:89:66 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:89:1
destructure computed key -> TypeError: null is not an object (evaluating 'null.name') [90:61] <anonymous>@places-throw-with-another-text-or-column.js:90:61 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:90:1
destructure assignment target -> TypeError: null is not an object (evaluating 'null.name') [91:69] <anonymous>@places-throw-with-another-text-or-column.js:91:69 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:91:1
destructure in for-of -> TypeError: Cannot destructure property 'a' from null or undefined value [92:55] <anonymous>@places-throw-with-another-text-or-column.js:92:55 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:92:1
destructure in catch -> TypeError: Cannot destructure property 'a' from null or undefined value [93:53] <anonymous>@places-throw-with-another-text-or-column.js:93:53 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:93:1
destructure second of two -> TypeError: Cannot destructure property 'a' from null or undefined value [94:79] <anonymous>@places-throw-with-another-text-or-column.js:94:79 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:94:1
destructure getter throws -> Error: getter [95:82] a@places-throw-with-another-text-or-column.js:95:82 | <anonymous>@places-throw-with-another-text-or-column.js:95:111 | attempt@places-throw-with-another-text-or-column.js:20:46
destructure iterator throws -> Error: iterator [96:94] [Symbol.iterator]@places-throw-with-another-text-or-column.js:96:94 | <anonymous>@places-throw-with-another-text-or-column.js:96:48 | attempt@places-throw-with-another-text-or-column.js:20:46
destructure next throws -> Error: next [97:108] next@places-throw-with-another-text-or-column.js:97:108 | <anonymous>@places-throw-with-another-text-or-column.js:97:44 | attempt@places-throw-with-another-text-or-column.js:20:46
for-of undefined -> TypeError: undefined is not an object [100:48] <anonymous>@places-throw-with-another-text-or-column.js:100:48 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:100:1
yield star -> TypeError: undefined is not a function [101:58] <anonymous>@places-throw-with-another-text-or-column.js:101:58 | <anonymous>@places-throw-with-another-text-or-column.js:101:36 | attempt@places-throw-with-another-text-or-column.js:20:46
iterator no next -> TypeError: undefined is not a function [102:48] <anonymous>@places-throw-with-another-text-or-column.js:102:48 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:102:1
dead zone let -> ReferenceError: Cannot access 'later' before initialization. [105:53] read@places-throw-with-another-text-or-column.js:105:53 | <anonymous>@places-throw-with-another-text-or-column.js:105:53 | attempt@places-throw-with-another-text-or-column.js:20:46
dead zone const -> ReferenceError: Cannot access 'later' before initialization. [106:55] read@places-throw-with-another-text-or-column.js:106:55 | <anonymous>@places-throw-with-another-text-or-column.js:106:55 | attempt@places-throw-with-another-text-or-column.js:20:46
dead zone class -> ReferenceError: Cannot access 'Later' before initialization. [107:55] read@places-throw-with-another-text-or-column.js:107:55 | <anonymous>@places-throw-with-another-text-or-column.js:107:55 | attempt@places-throw-with-another-text-or-column.js:20:46
dead zone store -> ReferenceError: Cannot access 'later' before initialization. [108:58] write@places-throw-with-another-text-or-column.js:108:58 | <anonymous>@places-throw-with-another-text-or-column.js:108:66 | attempt@places-throw-with-another-text-or-column.js:20:46
in number -> TypeError: 5 is not an Object. [111:37] <anonymous>@places-throw-with-another-text-or-column.js:111:37 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:111:1
in undefined -> TypeError: undefined is not an Object. [112:40] <anonymous>@places-throw-with-another-text-or-column.js:112:40 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:112:1
in member -> TypeError: null is not an Object. [113:37] <anonymous>@places-throw-with-another-text-or-column.js:113:37 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:113:1
in string -> TypeError: "abc" is not an Object. [114:42] <anonymous>@places-throw-with-another-text-or-column.js:114:42 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:114:1
private in number -> TypeError: 5 is not an Object. [115:81] has@places-throw-with-another-text-or-column.js:115:81 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:115:1
instanceof object -> TypeError: Object  is not a function [116:55] <anonymous>@places-throw-with-another-text-or-column.js:116:55 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:116:1
instanceof arrow -> TypeError: instanceof called on an object with an invalid prototype property. [117:37] <anonymous>@places-throw-with-another-text-or-column.js:117:37 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:117:1
instanceof hasInstance 5 -> TypeError: Object [Symbol.hasInstance] is not a function, undefined, or null [118:62] <anonymous>@places-throw-with-another-text-or-column.js:118:62 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:118:1
bigint Math -> TypeError: Conversion from 'BigInt' to 'number' is not allowed. [119:37] max@unknown | <anonymous>@places-throw-with-another-text-or-column.js:119:37 | attempt@places-throw-with-another-text-or-column.js:20:46
class without new -> TypeError: Cannot call a class constructor A without |new| [1:11] A@unknown:1:11 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:122:1
class member without new -> TypeError: Cannot call a class constructor without |new| [1:11] A@unknown:1:11 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:123:1
no super -> ReferenceError: 'super()' must be called in derived constructor before accessing |this| or returning non-object. [124:71] new B@places-throw-with-another-text-or-column.js:124:71 | <anonymous>@places-throw-with-another-text-or-column.js:124:86 | attempt@places-throw-with-another-text-or-column.js:20:46
derived returns number -> TypeError: Cannot return a non-object type in the constructor of a derived class B. [125:90] new B@places-throw-with-another-text-or-column.js:125:90 | <anonymous>@places-throw-with-another-text-or-column.js:125:120 | attempt@places-throw-with-another-text-or-column.js:20:46
extends number -> TypeError: The superclass is not a constructor. [126:51] <anonymous>@places-throw-with-another-text-or-column.js:126:51 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:126:1
extends undefined -> TypeError: The superclass is not a constructor. [127:54] <anonymous>@places-throw-with-another-text-or-column.js:127:54 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:127:1
extends member -> TypeError: The superclass is not a constructor. [128:51] <anonymous>@places-throw-with-another-text-or-column.js:128:51 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:128:1
extends arrow -> TypeError: The superclass is not a constructor. [129:40] <anonymous>@places-throw-with-another-text-or-column.js:129:40 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:129:1
extends bad prototype -> TypeError: The value of the superclass's prototype property is not an object or null. [130:91] <anonymous>@places-throw-with-another-text-or-column.js:130:91 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:130:1
extends null new -> TypeError: function is not a constructor [1:28] new B@unknown:1:28 | <anonymous>@places-throw-with-another-text-or-column.js:131:68 | attempt@places-throw-with-another-text-or-column.js:20:46
extends generator -> TypeError: The superclass is not a constructor. [132:44] <anonymous>@places-throw-with-another-text-or-column.js:132:44 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:132:1
super member of null -> TypeError: undefined is not an object (evaluating 'undefined.name') [133:93] run@places-throw-with-another-text-or-column.js:133:93 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:133:1
private method of other -> TypeError: Cannot access private method or acessor [134:85] run@places-throw-with-another-text-or-column.js:134:85 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:134:1
private store of other -> TypeError: Cannot access invalid private field [135:79] write@places-throw-with-another-text-or-column.js:135:79 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:135:1
private twice -> TypeError: Cannot redefine existing private field [1:28] new A@unknown:1:28 | <anonymous>@places-throw-with-another-text-or-column.js:136:146 | attempt@places-throw-with-another-text-or-column.js:20:46
static prototype -> TypeError: Attempting to change configurable attribute of unconfigurable property. [137:54] <anonymous>@places-throw-with-another-text-or-column.js:137:54 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:137:1
frozen array push -> TypeError: Attempted to assign to readonly property. [140:65] push@unknown | <anonymous>@places-throw-with-another-text-or-column.js:140:65 | attempt@places-throw-with-another-text-or-column.js:20:46
not extensible index -> TypeError: Attempted to assign to readonly property. [141:76] <anonymous>@places-throw-with-another-text-or-column.js:141:76 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:141:1
not configurable accessor -> TypeError: Attempting to change access mechanism for an unconfigurable property. [142:53] defineProperty@unknown | <anonymous>@places-throw-with-another-text-or-column.js:142:53 | attempt@places-throw-with-another-text-or-column.js:20:46
function name store strict -> TypeError: Attempted to assign to readonly property. [143:61] <anonymous>@places-throw-with-another-text-or-column.js:143:61 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:143:1
create number -> TypeError: Object prototype may only be an Object or null. [144:41] create@unknown | <anonymous>@places-throw-with-another-text-or-column.js:144:41 | attempt@places-throw-with-another-text-or-column.js:20:46
new Array -1 -> RangeError: Array length must be a positive integer of safe magnitude. [147:37] <anonymous>@places-throw-with-another-text-or-column.js:147:37 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:147:1
new Array fraction -> RangeError: Array length must be a positive integer of safe magnitude. [148:43] <anonymous>@places-throw-with-another-text-or-column.js:148:43 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:148:1
Array call -1 -> RangeError: Array length must be a positive integer of safe magnitude. [149:34] <anonymous>@places-throw-with-another-text-or-column.js:149:34 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:149:1
JSON circular deep -> TypeError: JSON.stringify cannot serialize cyclic structures. [20:46] stringify@unknown | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:152:1
replaceAll not global -> TypeError: String.prototype.replaceAll argument must not be a non-global regular expression [153:47] replaceAll@unknown | <anonymous>@places-throw-with-another-text-or-column.js:153:47 | attempt@places-throw-with-another-text-or-column.js:20:46
Promise without new -> TypeError: Cannot call a constructor Promise without |new| [1:11] Promise@native:1:11 | <anonymous>@places-throw-with-another-text-or-column.js:156:40 | attempt@places-throw-with-another-text-or-column.js:20:46
Proxy ownKeys -> TypeError: Proxy handler's 'ownKeys' method must return an array-like object containing only Strings and Symbols [157:41] keys@unknown | <anonymous>@places-throw-with-another-text-or-column.js:157:41 | attempt@places-throw-with-another-text-or-column.js:20:46
Object.keys undefined -> TypeError: undefined is not an object [158:49] keys@unknown | <anonymous>@places-throw-with-another-text-or-column.js:158:49 | attempt@places-throw-with-another-text-or-column.js:20:46
hasOwn undefined -> TypeError: undefined is not an object [159:44] hasOwn@unknown | <anonymous>@places-throw-with-another-text-or-column.js:159:44 | attempt@places-throw-with-another-text-or-column.js:20:46
apply list -> TypeError: second argument to Function.prototype.apply must be an Array-like object [160:41] <anonymous>@places-throw-with-another-text-or-column.js:160:41 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:160:1
structuredClone function -> DataCloneError: The object can not be cloned. [161:45] 
structuredClone symbol -> DataCloneError: The object can not be cloned. [162:43] 
Intl receiver -> TypeError: Intl.NumberFormat.prototype.format called on value that's not a NumberFormat [163:52] <anonymous>@places-throw-with-another-text-or-column.js:163:52 | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:163:1
tail call native -> TypeError: Conversion from 'BigInt' to 'number' is not allowed. [20:46] max@unknown | attempt@places-throw-with-another-text-or-column.js:20:46 | <anonymous>@places-throw-with-another-text-or-column.js:166:1
*/
