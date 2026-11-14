// Loose and strict equality of every pair of values, by code that knows no type, and elements of lists of doubles of every form.
function loose(a: any, b: any): any { return a == b; }
function looseNot(a: any, b: any): any { return a != b; }
function strict(a: any, b: any): any { return a === b; }
function strictNot(a: any, b: any): any { return a !== b; }
function branch(a: any, b: any): any { if (a == b) return "equal"; return "other"; }
function count(list: any, v: any): any { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] == v) n++; return n; }
function position(list: any, v: any): any { for (let i = 0; i < list.length; i++) if (list[i] === v) return i; return -1; }
class Money { constructor(public cents: any) {} valueOf(): any { return this.cents; } }
class Name { constructor(public text: any) {} toString(): any { return this.text; } }
const shared = { a: 1 }, list = [1], word = "wo" + "rd", half = ["wo", "rd"].join("");
const values: any[] = [0, 1, -1, 2147483647, -2147483648, 1.5, 2147483648, -0, NaN, Infinity, JSON.parse("[3, 0.5]")[0], 3, 4 / 2, 2, "", "0", "1", "1.5", "word", word, half, "wor" + (1 > 0 ? "d" : ""), " 1 ", "NaN", true, false, null, undefined, 1n, 0n, BigInt(3), 2n ** 70n, 2n ** 70n, Symbol.iterator, Symbol("x"), shared, { a: 1 }, list, [1], [], [[]], new Money(1), new Money("1"), new Name("word"), () => 1, /x/, new Date(5), new Number(1), new String("word"), new Boolean(false), Object.create(null), new Uint8Array([1]), new Map(), parseInt, { valueOf() { throw new TypeError("no"); } }];
let hash = 0, checks = 0;
function note(v: any): void { const t = String(v); for (let i = 0; i < t.length; i++) hash = (Math.imul(hash, 31) + t.charCodeAt(i)) | 0; checks++; }
function attempt(f: () => any): void { try { note(f()); } catch (e: any) { note(e.constructor.name); } }
for (const a of values) {
  for (const b of values) { attempt(() => loose(a, b)); attempt(() => looseNot(a, b)); attempt(() => strict(a, b)); attempt(() => strictNot(a, b)); attempt(() => branch(a, b)); }
  attempt(() => count(values.slice(0, 48), a)); attempt(() => position(values, a)); attempt(() => count([1.5, 2.5, NaN, 1], a)); attempt(() => count([1, 2, 3], a));
}
console.log(checks, hash);
// lists of doubles: plain, copy on write, with holes, past the end, of a class, with properties, frozen, with accessors, grown, turned into others
class Doubles extends Array<any> {}
function read(o: any, k: any): any { return o[k]; }
function sum(o: any, n: any): any { let s: any = 0; for (let i = 0; i < n; i++) s += o[i]; return s; }
const literal = (): any => [0.5, 1.5, 2, -0, 4.25];
const lists: any[] = [literal(), [0.5, , 2.5], Doubles.from([0.5, 1, 2.5]), Object.assign(literal(), { name: "x" }), Object.freeze(literal()), Object.seal(literal()), new Array(5).fill(0.5), Array.from({ length: 4 }, (_, i) => i / 2), literal().concat([1]), (() => { const l = literal(); l[9] = 1.5; return l; })(), (() => { const l = literal(); l.length = 2; return l; })(), (() => { const l = literal(); l.push("text"); return l; })(), (() => { const l = literal(); l[1] = NaN; return l; })(), (() => { const l = literal(); Object.defineProperty(l, 1, { get: () => 77 }); return l; })(), (() => { const l = literal(); delete l[2]; return l; })(), new Proxy(literal(), {}), Object.setPrototypeOf(literal(), { 2: "up" }), [NaN, NaN], [1.5].slice(0, 0)];
for (const l of lists) { for (const k of [0, 1, 2, 3, 4, 5, 9, 100, -1, 1.5, "0", "2", "length", "name"]) { const v = read(l, k); note(Object.is(v, -0) ? "-0" : v); } note(sum(l, 5)); note(sum(l, 12)); }
console.log(checks, hash);
