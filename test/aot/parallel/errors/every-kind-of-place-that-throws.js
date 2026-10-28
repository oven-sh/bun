// Every kind of place that throws: the class, the whole message, the line and column, and the first frames of the stack are those of plain Bun.
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
const key = opaque("name"), index = opaque(0); let textOfABillionSigns = "x"; for (let i = 0; i < 30; i++) textOfABillionSigns += textOfABillionSigns;
function thrower() { throw new Error("thrown behind a tail call"); }
const throwing = { method() { throw new Error("thrown in a method behind a tail call"); } };

// Calls of what is no function.
attempt("call variable", () => { nothing(); });
attempt("call null variable", () => { none(); });
attempt("call number variable", () => { five(); });
attempt("call member", () => { holder.absent(); });
attempt("call member number", () => { holder.run(); });
attempt("call member null", () => { holder.inner(); });
attempt("call deep member", () => { holder.deep.absent(); });
attempt("call computed member", () => { holder[key](); });
attempt("call indexed member", () => { list[index](); });
attempt("call optional then member", () => { holder?.deep.absent(); });
attempt("call member of this", function () { return this.absent(); }.bind(holder));
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
attempt("new Math", () => { new Math(); });

// Destructuring.
attempt("destructure undefined", () => { const { a } = nothing; return a; });
attempt("destructure null", () => { const { a } = none; return a; });
attempt("destructure empty pattern", () => { const {} = none; });
attempt("destructure default call", () => { const { a = holder.absent() } = plain; return a; });
attempt("destructure rest of null", () => { const { ...rest } = none; return rest; });
attempt("destructure assignment", () => { let a; ({ a } = none); return a; });

// Iteration.
attempt("for-of number", () => { for (const x of five) return x; });
attempt("for-of object", () => { for (const x of plain) return x; });
attempt("for-of member", () => { for (const x of holder.number) return x; });
attempt("spread number", () => { [...five]; });
attempt("spread undefined", () => { [...nothing]; });
attempt("spread member", () => { [...holder.inner]; });
attempt("spread argument", () => { Math.max(...five); });
attempt("spread argument undefined", () => { Math.max(...nothing); });
attempt("new Map of number", () => { new Map(five); });
attempt("new Set of number", () => { new Set(five); });
attempt("new Map of numbers", () => { new Map([1]); });
attempt("Array.from iterator 5", () => { Array.from({ [Symbol.iterator]: 5 }); });
attempt("Object.fromEntries", () => { Object.fromEntries(five); });
attempt("Promise.all sync", () => { Promise.all.call(5, []); });
attempt("iterator result", () => { for (const x of { [Symbol.iterator]() { return { next() { return 5; } }; } }) return x; });
attempt("iterator is number", () => { for (const x of { [Symbol.iterator]() { return 5; } }) return x; });

// Variables.
attempt("unknown variable", () => { absentVariable; });
attempt("unknown variable call", () => { absentVariable(); });
attempt("unknown variable store", () => { absentVariable = 1; });
attempt("unknown variable member", () => { absentVariable.name; });
attempt("dead zone own initializer", () => { let later = later + 1; return later; });
attempt("dead zone parameter", () => { ((a = b, b = 1) => a)(); });
attempt("class name store", () => { class Named { static run() { Named = 1; } } Named.run(); });
attempt("function name store", () => { (function named() { named = 1; })(); });

// Operators.
attempt("instanceof number", () => { plain instanceof five; });
attempt("instanceof undefined", () => { plain instanceof nothing; });
attempt("instanceof member", () => { plain instanceof holder.inner; });
attempt("instanceof object", () => { plain instanceof plain; });
attempt("instanceof object member", () => { plain instanceof holder.deep; });
attempt("instanceof bad prototype", () => { function F() {} F.prototype = 5; return plain instanceof F; });
attempt("bigint plus number", () => { opaque(1n) + five; });
attempt("bigint times number", () => { opaque(1n) * five; });
attempt("bigint unary plus", () => { +opaque(1n); });
attempt("bigint divide zero", () => { opaque(1n) / opaque(0n); });
attempt("bigint remainder zero", () => { opaque(1n) % opaque(0n); });
attempt("bigint negative power", () => { opaque(2n) ** opaque(-1n); });
attempt("bigint unsigned shift", () => { opaque(2n) >>> opaque(1n); });
attempt("bigint of fraction", () => { BigInt(opaque(1.5)); });
attempt("bigint of text", () => { BigInt(opaque("x")); });
attempt("bigint of undefined", () => { BigInt(nothing); });
attempt("symbol to string", () => { "" + opaque(Symbol("s")); });
attempt("symbol in template", () => { `${opaque(Symbol("s"))}`; });
attempt("symbol to number", () => { +opaque(Symbol("s")); });
attempt("symbol times", () => { opaque(Symbol("s")) * 2; });
attempt("object to primitive", () => { "" + opaque({ toString: null, valueOf: null }); });
attempt("object to primitive returns object", () => { "" + opaque({ toString() { return {}; }, valueOf() { return {}; } }); });
attempt("toPrimitive 5", () => { +opaque({ [Symbol.toPrimitive]: 5 }); });
attempt("toPrimitive returns object", () => { +opaque({ [Symbol.toPrimitive]() { return {}; } }); });
attempt("null prototype to string", () => { "" + opaque(Object.create(null)); });
attempt("null prototype as key", () => { plain[opaque(Object.create(null))]; });

// Classes.
attempt("this before super", () => { class A {} class B extends A { constructor() { this.x = 1; super(); } } return new B(); });
attempt("super twice", () => { class A {} class B extends A { constructor() { super(); super(); } } return new B(); });
attempt("super method absent", () => { class A {} class B extends A { run() { return super.absent(); } } return new B().run(); });
attempt("private method store", () => { class A { #m() {} run() { this.#m = 1; } } return new A().run(); });
attempt("private getter only store", () => { class A { get #g() { return 1; } run() { this.#g = 1; } } return new A().run(); });
attempt("private setter only read", () => { class A { set #s(v) {} run() { return this.#s; } } return new A().run(); });
attempt("getter only store", () => { class A { get g() { return 1; } } new A().g = 2; });
attempt("new.target call", () => { function F() { if (!new.target) throw new TypeError("needs new"); } return F(); });

// Objects that refuse.
attempt("frozen store", () => { Object.freeze(opaque({ a: 1 })).a = 2; });
attempt("frozen add", () => { Object.freeze(opaque({ a: 1 })).b = 2; });
attempt("frozen delete", () => { delete Object.freeze(opaque({ a: 1 })).a; });
attempt("frozen array store", () => { Object.freeze(opaque([1]))[0] = 2; });
attempt("frozen array add", () => { Object.freeze(opaque([1]))[1] = 2; });
attempt("frozen array length", () => { Object.freeze(opaque([1])).length = 0; });
attempt("frozen array pop", () => { Object.freeze(opaque([1])).pop(); });
attempt("sealed add", () => { Object.seal(opaque({ a: 1 })).b = 2; });
attempt("sealed delete", () => { delete Object.seal(opaque({ a: 1 })).a; });
attempt("not extensible add", () => { Object.preventExtensions(opaque({})).b = 2; });
attempt("not extensible define", () => { Object.defineProperty(Object.preventExtensions(opaque({})), "b", { value: 1 }); });
attempt("not extensible prototype", () => { Object.setPrototypeOf(Object.preventExtensions(opaque({})), {}); });
attempt("read-only store", () => { Object.defineProperty(opaque({}), "a", { value: 1 }).a = 2; });
attempt("read-only inherited store", () => { Object.create(Object.defineProperty({}, "a", { value: 1 })).a = 2; });
attempt("getter only object store", () => { opaque({ get a() { return 1; } }).a = 2; });
attempt("not configurable delete", () => { delete Object.defineProperty(opaque({}), "a", { value: 1 }).a; });
attempt("not configurable redefine", () => { Object.defineProperty(Object.defineProperty(opaque({}), "a", { value: 1 }), "a", { value: 2 }); });
attempt("descriptor both", () => { Object.defineProperty(opaque({}), "a", { value: 1, get() {} }); });
attempt("descriptor getter 5", () => { Object.defineProperty(opaque({}), "a", { get: 5 }); });
attempt("descriptor number", () => { Object.defineProperty(opaque({}), "a", 5); });
attempt("define on number", () => { Object.defineProperty(five, "a", {}); });
attempt("string index store", () => { text[0] = "x"; });
attempt("string length store", () => { text.length = 1; });
attempt("number member store", () => { five.a = 1; });
attempt("string member store", () => { text.a = 1; });
attempt("symbol member store", () => { opaque(Symbol()).a = 1; });
attempt("arguments callee", function () { return arguments.callee; });
attempt("function caller", () => { (function f() { return f.caller; })(); });
attempt("prototype cycle", () => { const a = {}, b = Object.create(a); Object.setPrototypeOf(a, b); });
attempt("prototype number", () => { Object.setPrototypeOf(opaque({}), five); });
attempt("array length store", () => { opaque([]).length = -1; });
attempt("array length fraction", () => { opaque([]).length = 1.5; });
attempt("undefined store global", () => { undefined = 1; });
attempt("NaN store global", () => { NaN = 1; });
attempt("globalThis undefined", () => { globalThis.undefined = 1; });

// Ranges.
attempt("repeat -1", () => { text.repeat(opaque(-1)); });
attempt("repeat Infinity", () => { text.repeat(opaque(Infinity)); });
attempt("repeat huge", () => { text.repeat(opaque(2 ** 31)); });
attempt("padEnd huge", () => { text.padEnd(opaque(2 ** 32), "x"); });
attempt("toFixed", () => { five.toFixed(opaque(101)); });
attempt("toPrecision", () => { five.toPrecision(opaque(0)); });
attempt("toExponential", () => { five.toExponential(opaque(-1)); });
attempt("toString radix", () => { five.toString(opaque(1)); });
attempt("fromCodePoint", () => { String.fromCodePoint(opaque(-1)); });
attempt("normalize", () => { text.normalize(opaque("x")); });
attempt("new ArrayBuffer", () => { new ArrayBuffer(opaque(-1)); });
attempt("new Uint8Array -1", () => { new Uint8Array(opaque(-1)); });
attempt("new Uint32Array offset", () => { new Uint32Array(new ArrayBuffer(8), opaque(1)); });
attempt("new Uint32Array length", () => { new Uint32Array(new ArrayBuffer(8), 0, opaque(9)); });
attempt("typed set offset", () => { new Uint8Array(1).set([1, 2], opaque(1)); });
attempt("DataView get", () => { new DataView(new ArrayBuffer(1)).getInt32(opaque(0)); });
attempt("DataView offset", () => { new DataView(new ArrayBuffer(1), opaque(2)); });
attempt("toISOString", () => { new Date(opaque(NaN)).toISOString(); });
attempt("Intl locale", () => { new Intl.NumberFormat(opaque("xx-invalid-locale-x")); });
attempt("Intl currency", () => { new Intl.NumberFormat("en", { style: "currency" }); });
attempt("localeCompare", () => { text.localeCompare("b", opaque("x_y")); });
attempt("stack overflow", () => { const again = () => again() + 1; return again(); });
attempt("concat huge", () => { let s = opaque(textOfABillionSigns); return (s + s + s + s).length; });
attempt("at BigInt", () => { BigInt.asIntN(opaque(-1), 1n); });
attempt("flat depth symbol", () => { list.flat(opaque(Symbol())); });
attempt("with index", () => { list.with(opaque(9), 1); });
attempt("decodeURIComponent", () => { decodeURIComponent(opaque("%")); });
attempt("encodeURI", () => { encodeURI(opaque("\ud800")); });

// Text that is parsed.
attempt("JSON empty", () => { JSON.parse(opaque("")); });
attempt("JSON brace", () => { JSON.parse(opaque("{")); });
attempt("JSON token", () => { JSON.parse(opaque('{"a":x}')); });
attempt("JSON undefined", () => { JSON.parse(nothing); });
attempt("JSON trailing", () => { JSON.parse(opaque("1 2")); });
attempt("JSON circular", () => { const o = {}; o.self = o; return JSON.stringify(o); });
attempt("JSON bigint", () => { JSON.stringify(opaque({ a: 1n })); });
attempt("JSON toJSON throws", () => { JSON.stringify({ toJSON() { throw new Error("toJSON"); } }); });
attempt("JSON reviver throws", () => { JSON.parse("[1]", () => { throw new Error("reviver"); }); });
attempt("RegExp paren", () => { new RegExp(opaque("(")); });
attempt("RegExp flags", () => { new RegExp("a", opaque("zz")); });
attempt("RegExp class", () => { new RegExp(opaque("[b-a]")); });
attempt("RegExp quantifier", () => { new RegExp(opaque("a{2,1}")); });
attempt("RegExp group name", () => { new RegExp(opaque("(?<a>x)(?<a>y)")); });
attempt("matchAll not global", () => { text.matchAll(/a/); });
attempt("startsWith RegExp", () => { text.startsWith(/a/); });
attempt("Function text", () => { new Function(opaque("return (")); });
attempt("eval text", () => { (0, eval)(opaque("let let")); });
attempt("eval throws", () => { (0, eval)(opaque("null.x")); });
attempt("Function throws", () => { new Function(opaque("return null.x"))(); });

// Receivers and arguments that built-ins refuse.
attempt("Map get receiver", () => { Map.prototype.get.call(plain, 1); });
attempt("Set add receiver", () => { Set.prototype.add.call(plain, 1); });
attempt("WeakMap key", () => { new WeakMap().set(five, 1); });
attempt("WeakSet key", () => { new WeakSet().add(five); });
attempt("WeakRef target", () => { new WeakRef(five); });
attempt("Map without new", () => { Map(); });
attempt("Promise executor", () => { new Promise(five); });
attempt("Promise then receiver", () => { Promise.prototype.then.call(plain); });
attempt("Promise resolve receiver", () => { Promise.resolve.call(five); });
attempt("Proxy target", () => { new Proxy(five, {}); });
attempt("Proxy handler", () => { new Proxy({}, five); });
attempt("Proxy without new", () => { Proxy({}, {}); });
attempt("Proxy revoked get", () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy.a; });
attempt("Proxy revoked call", () => { const { proxy, revoke } = Proxy.revocable(() => 1, {}); revoke(); return proxy(); });
attempt("Proxy trap 5", () => { new Proxy({}, { get: 5 }).a; });
attempt("Proxy invariant get", () => { new Proxy(Object.defineProperty({}, "a", { value: 1 }), { get: () => 2 }).a; });
attempt("Proxy invariant has", () => { "a" in new Proxy(Object.defineProperty({}, "a", { value: 1 }), { has: () => false }); });
attempt("Proxy set false", () => { new Proxy({}, { set: () => false }).a = 1; });
attempt("Proxy delete false", () => { delete new Proxy({}, { deleteProperty: () => false }).a; });
attempt("Proxy define false", () => { Object.defineProperty(new Proxy({}, { defineProperty: () => false }), "a", {}); });
attempt("Proxy trap throws", () => { new Proxy({}, { get() { throw new Error("trap"); } }).a; });
attempt("Reflect ownKeys", () => { Reflect.ownKeys(five); });
attempt("Reflect apply", () => { Reflect.apply(five, null, []); });
attempt("Reflect apply list", () => { Reflect.apply(() => 1, null, five); });
attempt("Reflect construct", () => { Reflect.construct(() => 1, []); });
attempt("Reflect get", () => { Reflect.get(five, "a"); });
attempt("Object.entries null", () => { Object.entries(none); });
attempt("Object.assign null", () => { Object.assign(none, {}); });
attempt("Object.groupBy", () => { Object.groupBy(list, five); });
attempt("forEach callback", () => { list.forEach(five); });
attempt("map callback", () => { list.map(nothing); });
attempt("filter callback", () => { list.filter(plain); });
attempt("reduce callback", () => { list.reduce(five); });
attempt("reduce empty", () => { opaque([]).reduce((a, b) => a + b); });
attempt("sort comparator", () => { list.sort(five); });
attempt("find callback", () => { list.find(text); });
attempt("flatMap callback", () => { list.flatMap(five); });
attempt("Array.from mapper", () => { Array.from(list, five); });
attempt("array method on null", () => { Array.prototype.map.call(none, x => x); });
attempt("string method on null", () => { String.prototype.trim.call(none); });
attempt("string method on undefined", () => { String.prototype.at.call(nothing, 0); });
attempt("number method receiver", () => { Number.prototype.toFixed.call(text); });
attempt("symbol description receiver", () => { Object.getOwnPropertyDescriptor(Symbol.prototype, "description").get.call(five); });
attempt("date receiver", () => { Date.prototype.getTime.call(plain); });
attempt("regexp receiver", () => { RegExp.prototype.exec.call(plain, "a"); });
attempt("regexp exec 5", () => { RegExp.prototype.test.call({ exec: () => 5 }, "a"); });
attempt("function toString receiver", () => { Function.prototype.toString.call(plain); });
attempt("bind receiver", () => { Function.prototype.bind.call(plain); });
attempt("typed array receiver", () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length").get.call(plain); });
attempt("typed array without new", () => { Uint8Array(1); });
attempt("typed array abstract", () => { new (Object.getPrototypeOf(Uint8Array))(); });
attempt("detached buffer", () => { const b = new ArrayBuffer(8), v = new Uint8Array(b); structuredClone(b, { transfer: [b] }); return v.fill(1); });
attempt("generator running", () => { const g = (function* () { g.next(); })(); return g.next(); });
attempt("generator receiver", () => { (function* () {})().next.call(plain); });
attempt("generator throw", () => { (function* named() { yield 1; })().throw(new Error("into a generator")); });
attempt("Symbol.keyFor", () => { Symbol.keyFor(five); });
attempt("Atomics", () => { Atomics.add(list, 0, 1); });
attempt("FinalizationRegistry", () => { new FinalizationRegistry(five); });
attempt("Error cause", () => { throw new Error("outer", { cause: new TypeError("inner") }); });
attempt("AggregateError", () => { throw new AggregateError([new Error("one")], "many"); });
attempt("SuppressedError", () => { throw new SuppressedError(new Error("a"), new Error("b"), "suppressed"); });
attempt("DOMException", () => { throw new DOMException("text", "AbortError"); });

// The same in the position of a tail call: strict code leaves its frame before such a call.
attempt("tail call variable", () => nothing());
attempt("tail call member", () => holder.absent());
attempt("tail call deep member", () => holder.deep.absent());
attempt("tail call computed member", () => holder[key]());
attempt("tail call of this", function () { return this.absent(); }.bind(holder));
attempt("tail call function that throws", () => thrower());
attempt("tail call method that throws", () => throwing.method());
attempt("tail return in a function", function named() { return holder.absent(); });
