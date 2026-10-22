// Many literals have the same fields, or the same fields at the start, at the end or in the middle of others. Whatever the compiler shares between them, each evaluation makes an object of its own with its own fields in its own order.
function keysAndValues(value: object): string {
  return Object.entries(value)
    .map(([key, member]) => key + "=" + JSON.stringify(member))
    .join(",");
}

function abc(seed: number) {
  return { a: seed, b: seed + 1, c: seed + 2 };
}
function abcAgain(seed: number) {
  return { a: seed, b: seed + 1, c: seed + 2 };
}
function abcOfTexts(seed: string) {
  return { a: seed, b: seed + "1", c: seed + "2" };
}
function abcOfFractions(seed: number) {
  return { a: seed + 0.5, b: seed + 1.5, c: seed + 2.5 };
}
function abcd(seed: number) {
  return { a: seed, b: seed + 1, c: seed + 2, d: seed + 3 };
}
function zabc(seed: number) {
  return { z: seed - 1, a: seed, b: seed + 1, c: seed + 2 };
}
function bc(seed: number) {
  return { b: seed + 1, c: seed + 2 };
}
function ab(seed: number) {
  return { a: seed, b: seed + 1 };
}
function cba(seed: number) {
  return { c: seed + 2, b: seed + 1, a: seed };
}
function abcWithPrototype(seed: number) {
  return { __proto__: { inherited: "yes" }, a: seed, b: seed + 1, c: seed + 2 };
}
function abcOfConstants() {
  return { a: 1, b: 2, c: 3 };
}
function abcOfConstantsAgain() {
  return { a: 1, b: 2, c: 3 };
}
function abcNested(seed: number) {
  return { a: { a: seed, b: seed, c: seed }, b: { a: seed, b: seed, c: seed }, c: { a: seed, b: seed, c: seed } };
}
class Abc {
  a = 1;
  b = 2;
  c = 3;
}

function bOf(value: { a: number; b: number; c: number }): unknown {
  return value.b;
}
function setB(value: { a: number; b: number; c: number }, to: number): void {
  value.b = to;
}

const all: [string, () => object][] = [
  ["abc", () => abc(1)],
  ["abc again", () => abcAgain(1)],
  ["texts", () => abcOfTexts("t")],
  ["fractions", () => abcOfFractions(1)],
  ["abcd", () => abcd(1)],
  ["zabc", () => zabc(1)],
  ["bc", () => bc(1)],
  ["ab", () => ab(1)],
  ["cba", () => cba(1)],
  ["with a prototype", () => abcWithPrototype(1)],
  ["constants", abcOfConstants],
  ["constants again", abcOfConstantsAgain],
  ["nested", () => abcNested(1)],
  ["class", () => new Abc()],
];

for (const [name, make] of all) {
  const one = make() as any;
  const two = make() as any;
  const before = keysAndValues(one);
  const read = String(typeof bOf(one) === "object" ? "object" : bOf(one));
  setB(one, -5);
  one.added = true;
  delete one.a;
  console.log(name + ":", before, "| b", read, "| changed", keysAndValues(one), "| the other", keysAndValues(two), "| a third", keysAndValues(make()), one === two);
}

const nested = abcNested(1);
nested.a.b = 100;
console.log(keysAndValues(nested), nested.a === nested.b, (abcWithPrototype(1) as any).inherited, Object.getPrototypeOf(abcWithPrototype(1)) === Object.getPrototypeOf(abcWithPrototype(1)));
const frozen = Object.freeze(abcOfConstants());
console.log(Object.isFrozen(frozen), Object.isFrozen(abcOfConstants()), Object.isFrozen(abcOfConstantsAgain()));

export {};
