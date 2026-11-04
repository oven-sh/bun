// A call of a built-in that is known is compiled behind tests of its operands. Each function first sees what the row takes as it is, and at the very next call something else.
const log = [];
const show = (label, make) => {
  let answer;
  try {
    answer = make();
  } catch (error) {
    answer = `${error.constructor.name}: ${error.message}`;
  }
  console.log(label, typeof answer === "object" && answer !== null ? JSON.stringify(answer instanceof Set || answer instanceof Map ? [...answer] : answer) : Object.is(answer, -0) ? "-0" : String(answer), log.splice(0).join(","));
};

function keysAtOnce(value) { return Object.keys(value); }
function keys(value) { return Object.keys(value).length + 1; }
function entries(value) { return Object.entries(value); }
function values(value) { return Object.values(value); }
function largest(a, b) { return Math.max(a, b); }
function smallest(a, b) { return Math.min(a, b) + 0; }
function floored(a) { return Math.floor(a); }
function same(a, b) { return Object.is(a, b); }
function setOf(values) { return new Set(values); }
function mapOf(pairs) { return new Map(pairs); }
function assigned(target, source) { return Object.assign(target, source); }
function above(value) { return Object.getPrototypeOf(value) === Object.prototype; }

const spoken = (name, value) => ({ valueOf() { log.push(name); return value; } });
const trapped = () => new Proxy({ a: 1, b: 2 }, {
  ownKeys(target) { log.push("ownKeys"); return Reflect.ownKeys(target); },
  getOwnPropertyDescriptor(target, key) { log.push(`describe ${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
  get(target, key) { log.push(`get ${String(key)}`); return target[key]; },
});
const counting = () => ({ *[Symbol.iterator]() { log.push("iterated"); yield 1; yield 1; yield 2; } });
function listWithOwnIterator() {
  const list = [1, 2];
  list[Symbol.iterator] = function* () { log.push("own iterator"); yield "other"; };
  return list;
}

const warm = () => {
  for (let turn = 0; turn < 3; turn++) {
    keysAtOnce({ a: 1 }); keys({ a: 1 }); entries({ a: 1 }); values({ a: 1 }); largest(1, 2); smallest(1, 2); floored(1.5); same(1, 1);
    setOf([1, 2]); mapOf([[1, 2]]); assigned({}, { a: 1 }); above({});
  }
};

for (const [name, make] of Object.entries({
  object: () => ({ b: 1, a: 2, 1: 3 }), list: () => ["x", "y"], text: () => "ab", number: () => 5, yes: () => true, symbol: () => Symbol("s"),
  nothing: () => undefined, empty: () => null, proxy: trapped, call: () => function f() {}, getter: () => ({ get a() { log.push("getter"); return 1; } }),
  hidden: () => Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }),
})) {
  warm();
  show(`${name} keys at once`, () => keysAtOnce(make()));
  show(`${name} keys`, () => keys(make()));
  show(`${name} entries`, () => entries(make()));
  show(`${name} values`, () => values(make()));
  show(`${name} above`, () => above(make()));
  show(`${name} assigned from`, () => assigned({ z: 0 }, make()));
  show(`${name} assigned to`, () => assigned(make(), { z: 0 }));
}

for (const [name, a, b] of [
  ["numbers", () => 1, () => 2], ["zeros", () => 0, () => -0], ["zeros turned", () => -0, () => 0], ["not a number", () => NaN, () => 1], ["texts", () => "3", () => "10"],
  ["objects", () => spoken("first", 1), () => spoken("second", 2)], ["number and object", () => 5, () => spoken("second", 2)], ["object and number", () => spoken("first", 7), () => 2],
  ["symbol", () => Symbol("s"), () => spoken("second", 2)], ["object and symbol", () => spoken("first", 1), () => Symbol("s")], ["big", () => 1n, () => 2],
  ["nothing", () => undefined, () => 1], ["empty", () => null, () => -1], ["yes", () => true, () => 0.5], ["lists", () => [4], () => [[5]]],
]) {
  warm();
  show(`${name} largest`, () => largest(a(), b()));
  show(`${name} smallest`, () => smallest(a(), b()));
  show(`${name} floored`, () => floored(a()));
  show(`${name} same`, () => same(a(), b()));
  show(`${name} same as itself`, () => { const value = a(); return same(value, value); });
}
const half = String(Date.now()).slice(0, 2);
show("two texts that read alike", () => same("a" + half, "a" + half));
show("two big integers that are equal", () => same(10n ** 30n, 10n ** 30n));

for (const [name, make] of Object.entries({
  list: () => [1, 1, 2], holes: () => [1, , 2], text: () => "aab", nothing: () => undefined, empty: () => null, number: () => 5, iterable: counting, ownIterator: listWithOwnIterator,
  set: () => new Set([3, 4]), given: () => (function () { return arguments; })(7, 7, 8), pairs: () => [[1, 2], [1, 3]], badPairs: () => [1, 2],
  map: () => new Map([[1, 2]]), classBelow: () => (class extends Array {}).from([[5, 6]]),
})) {
  warm();
  show(`${name} set`, () => setOf(make()));
  show(`${name} map`, () => mapOf(make()));
}
