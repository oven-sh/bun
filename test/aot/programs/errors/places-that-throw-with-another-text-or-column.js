// The places that throw where the message, a column or a frame of a built-in is not that of plain Bun: see docs/bundler/aot-compatibility.mdx#error-messages and docs/bundler/aot-debugging.mdx#stack-traces. The class and the line are the same.
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
attempt("call member", () => { holder.absent(); });
attempt("call member number", () => { holder.run(); });
attempt("call member null", () => { holder.inner(); });
attempt("call deep member", () => { holder.deep.absent(); });
attempt("call computed member", () => { holder[key](); });
attempt("call indexed member", () => { list[index](); });
attempt("call with arguments", () => { holder.absent(1, "two", [3]); });
attempt("call of a call", () => { (() => 5)()(); });
attempt("call optional then member", () => { holder?.deep.absent(); });
attempt("call member of this", function () { return this.absent(); }.bind(holder));
attempt("call spread", () => { holder.absent(...list); });
attempt("call tagged template", () => { holder.absent`x`; });
attempt("call via call", () => { holder.absent.call(null); });
attempt("call of string method absent", () => { text.absent(); });
attempt("call of number method absent", () => { five.absent(); });
attempt("call of array method absent", () => { list.absent(); });
attempt("call global absent", () => { globalThis.absentGlobal(); });
attempt("call Math absent", () => { Math.absent(); });
attempt("call console absent", () => { console.absent(); });
attempt("call in argument", () => { String(holder.absent()); });
attempt("call in template", () => { `${holder.absent()}`; });
attempt("new variable", () => { new nothing(); });
attempt("new number", () => { new five(); });
attempt("new member", () => { new holder.absent(); });
attempt("new member number", () => { new holder.run(); });
attempt("new arrow", () => { new (() => 1)(); });
attempt("new method", () => { new ({ m() {} }).m(); });
attempt("new Symbol", () => { new Symbol(); });
attempt("new Math", () => { new Math(); });
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
attempt("destructure default call", () => { const { a = holder.absent() } = plain; return a; });
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
attempt("instanceof object", () => { plain instanceof plain; });
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
attempt("super method absent", () => { class A {} class B extends A { run() { return super.absent(); } } return new B().run(); });
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
attempt("tail call member", () => holder.absent());
attempt("tail call deep member", () => holder.deep.absent());
attempt("tail call computed member", () => holder[key]());
attempt("tail call of this", function () { return this.absent(); }.bind(holder));
attempt("tail call native", () => Math.max(opaque(1n)));
attempt("tail return in a function", function named() { return holder.absent(); });
