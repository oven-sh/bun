// Object.prototype.toString of every kind of value, called the ways libraries call it, and what a program may and may not do to change the answers.
const toString = Object.prototype.toString;
class Tagged { get [Symbol.toStringTag]() { return "Mine"; } }
class Below extends Array {}
const values = ["text", "", "ro" + JSON.parse('"pe"'), 5, -0, 1.5, NaN, true, false, undefined, null, Symbol("s"), Symbol.iterator, 10n, {}, [], new Below(), () => 1, function () {}, class {}, async () => {}, function* () {}, new Date(0), /x/, new Error("e"), new TypeError("t"), new Map(), new Set(), new WeakMap(), Promise.resolve(), new String("w"), new Number(1), new Boolean(false), Object(Symbol("o")), Object(1n), new Tagged(), { [Symbol.toStringTag]: "Own" }, { [Symbol.toStringTag]: 5 }, Object.create(null), Object.create({ [Symbol.toStringTag]: "Above" }), new Proxy([], {}), new Proxy({}, { get(target, key) { return key === Symbol.toStringTag ? "Trapped" : undefined; } }), new Uint8Array(1), Buffer.from("b"), new ArrayBuffer(1), new DataView(new ArrayBuffer(1)), JSON, Math, Reflect, globalThis, (function () { return arguments; })(), new Response("r"), new URL("http://a/"), new Headers(), process, [].values(), new Map().entries(), "x"[Symbol.iterator](), (function* () {})()];
function tagOf(x) { const tag = toString.call(x); return tag; }
function sliced(x) { return Object.prototype.toString.call(x).slice(8, -1); }
function applied(x) { const tag = toString.apply(x); return tag + ""; }
function inside(x) { try { const tag = toString.call(x); return tag; } catch (error) { return "caught " + error.name; } }
function isString(x) { return toString.call(x) === "[object String]"; }
let lines = [];
for (let round = 0; round < 30; round++) lines = [tagOf, sliced, applied, inside, isString].map(f => f.name + " " + values.map(value => { try { return f(value); } catch (error) { return "throws " + error.name; } }).join("|"));
console.log(lines.join("\n"));
const revoked = Proxy.revocable([], {}); revoked.revoke(); console.log(inside(revoked.proxy));
console.log(tagOf({ get [Symbol.toStringTag]() { throw new RangeError("no"); } } === null), inside({ get [Symbol.toStringTag]() { throw new RangeError("no"); } }));
for (const [name, holder] of [["String", String.prototype], ["Number", Number.prototype], ["Boolean", Boolean.prototype], ["Object", Object.prototype], ["Symbol", Symbol.prototype], ["BigInt", BigInt.prototype]]) {
  let said; try { Object.defineProperty(holder, Symbol.toStringTag, { value: "Changed", configurable: true }); said = "defined"; } catch (error) { said = "refused " + error.name; }
  console.log(name, said, tagOf("t"), tagOf(1), tagOf(true), tagOf({}), tagOf(Symbol.iterator), tagOf(1n));
}
