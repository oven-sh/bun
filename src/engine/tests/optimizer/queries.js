class A { a = 1; }
class B extends A { b = 2; }
class Odd { static [Symbol.hasInstance](value) { return value === 1; } }
function F() { this.x = 1; }
class P {
  #x = 1;
  #m() { return 2; }
  static get(o) { return [o.#x, o.#m()]; }
  static set(o) { return ++o.#x; }
  static has(o) { return [#x in o, #m in o]; }
}
const key = Symbol("k"), late = (...parts) => parts.join("");
const objects = () => [
  new A(), new B(), new F(), new P(), new (class extends P {})(), { a: 1, x: 2 }, Object.create(null), Object.create(new B()),
  Object.freeze({ a: 1 }), [1], new Proxy(new A(), { getPrototypeOf: () => F.prototype, has: () => true }), 1, "a", null,
].map(a => [a]);

for (const body of [
  "a instanceof A", "(a instanceof B ? a.b : 0)", "a instanceof F || a instanceof Odd", "a instanceof F.bind()", "a instanceof (() => {})",
  '"a" in a', '("x" in a ? a.x : 0)', '"toString" in a', "[delete a.a, a.a, a]", "delete a.length", 'delete a["a" + ""]',
  "{ 'use strict'; return delete a.a; }", "{ const old = a.a; delete a.a; a.z = 5; return [old, a.z, a.a, a]; }",
  "Object.getPrototypeOf(a) === A.prototype", "({ __proto__: a, m() { return super.a; } }).m()",
  "P.get(a)", "P.set(a)", "P.has(a)", "/a/.test(a)", "{ const r = /a/g; return [r.test('aa'), r.lastIndex, /a/g.lastIndex]; }",
]) {
  const objects = () => [{ a: 1, b: 2 }, { a: 1 }, Object.create({ x: 1 }), Object.create(null), { [key]: 1, a: 2 }, Object.defineProperty({ a: 1 }, "b", { value: 2 }),
  new String("ab"), [1, 2], Object.freeze({ a: 1 }), (() => { const o = { a: 1 }; o[0] = 1; return o; })(), (() => { const o = { a: 1 }; delete o.a; return o; })(),
  (() => { const o = { a: 1 }; for (let i = 0; i < 300; i++) o["k" + i] = i; return o; })(), new Date(0), Object.assign(Object.create({ p: 1 }), { q: 2 })];
for (const name of ["keys", "getOwnPropertyNames", "getOwnPropertySymbols", "values", "entries", "x"])
  checkInTurn(name === "x" ? "o => [Reflect.ownKeys(o), Reflect.ownKeys(o).length]"
    : `o => { const first = Object.${name}(o); const copy = Object.${name}(o); copy.push("x"); copy[0] = 0; return [first, copy, Object.${name}(o), first.length]; }`, oneOf(objects), 30);
checkInTurn("o => { const a = Object.keys(o); a.length = 0; return [a, Object.keys(o)]; }", oneOf(objects), 30);
check("o => [Object.getPrototypeOf(o) === Object.prototype, Object.getPrototypeOf(o) === null, Reflect.getPrototypeOf(o) === Object.prototype]", oneOf(objects));
check("v => [Object.getPrototypeOf(v) === Object.prototype, Object.getPrototypeOf(v) === String.prototype]", oneOf(() => [1, "a", true, Symbol.iterator, 2n, {}, [], null, undefined, new String("a")]));
const sames = () => [0, -0, 1, 1.5, NaN, 0 / 0, Infinity, "a", "a" + late("", ""), 2n, 2n + 0n, Symbol.iterator, true, null, undefined, {}, Object.prototype, 2 ** 53, 2 ** 53 + 2];
check((a, b) => [Object.is(a, b), Object.is(a, a), Object.is(b, b)], across(sames, sames));

check(`a => ${body}`, objects);
  checkInTurn(`a => ${body}`, objects);
}
checkInTurn((a, c) => a instanceof c, () => [A, B, F, Odd, {}, 1].flatMap(c => [[new B(), c], [1, c]]));
checkInTurn(c => Reflect.construct(F, [], c) instanceof c, () => [[A], [B], [F], [new Proxy(A, {})]], 60);

function after(make, use, change, expected) {
  const made = make();
  for (let turn = 0; turn < 100; turn++) use(made);
  change(made);
  if (use(made) !== expected) throw new Error(`${use} after ${change}`);
}
const family = () => { class X { m() { return 1; } } class Y extends X { m() { return super.m(); } } return { X, Y, y: new Y() }; };
after(family, it => it.y instanceof it.X, it => Object.setPrototypeOf(it.Y.prototype, null), false);
after(family, it => it.y instanceof it.X, it => Object.defineProperty(it.X, Symbol.hasInstance, { value: () => 0 }), false);
after(family, it => "k" in it.y, it => (it.X.prototype.k = 1), true);
after(family, it => it.y.m(), it => Object.setPrototypeOf(it.Y.prototype, { m: () => 2 }), 2);
