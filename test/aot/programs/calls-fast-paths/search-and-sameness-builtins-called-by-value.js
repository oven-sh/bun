// Object.is, isNaN, Array.prototype.includes and indexOf reached as values that the build cannot name: every kind of operand, so that the short paths answer what the built-ins answer and hand on what they do not cover.
const names = process.argv.length > 100 ? ["x"] : ["is", "isNaN", "includes", "indexOf"];
const holder = { is: Object.is, isNaN, includes: Array.prototype.includes, indexOf: Array.prototype.indexOf };
const pick = index => holder[names[index]];
const is = pick(0), notANumber = pick(1), includes = pick(2), indexOf = pick(3);

const rope = part => part + "-" + part + "-" + names.length;
const flat = text => JSON.parse(JSON.stringify(text));
const symbol = Symbol("s"), object = { a: 1 }, other = { a: 1 }, big = 10n ** 30n;
const half = names.length / 8;
const values = [
  0, -0, 1, half * 2, half, -1, 2 ** 31, 2 ** 53, NaN, -NaN, 0 / 0, Infinity, -Infinity, undefined, null, true, false,
  "", "a", "ab", flat("ab"), "abc", "abd", flat("abd"), "ab\u0100", flat("ab\u0100"), "\u0100bc", rope("ab"), rope("ab"), flat(rope("ab")), "ab-ab-4", "ab-ab-5", "ü", flat("ü"), "\u{1f600}",
  flat("x".repeat(100) + "a"), flat("x".repeat(100) + "b"), flat("x".repeat(100) + "a"), flat("\u0100".repeat(40) + "a"), flat("\u0100".repeat(40) + "b"), flat("\u0100".repeat(40) + "a"),
  symbol, Symbol("s"), Symbol.iterator, object, other, [], big, 10n ** 30n, 0n, 1n, () => 1, new String("ab"), new Number(1),
];
const show = value => (typeof value === "symbol" || typeof value === "bigint" || typeof value === "function" ? String(value) : Object.is(value, -0) ? "-0" : JSON.stringify(value) ?? String(value));

let lines = [];
for (const first of values) lines.push(values.map(second => (is(first, second) ? "1" : "0")).join(""));
console.log(lines.join("\n"));
console.log(is(), is(undefined), is(1), is(NaN), is(1, 1, 2), is.call(null, object, object));

const convertible = [...values.filter(value => typeof value !== "symbol" && typeof value !== "bigint"), { valueOf: () => NaN }, { valueOf: () => 1 }, "1", "x", " ", [1], [1, 2]];
console.log(convertible.map(value => (notANumber(value) ? "1" : "0")).join(""), notANumber(), notANumber(NaN, 1));
for (const value of [symbol, big]) {
  try {
    notANumber(value);
  } catch (error) {
    console.log(error.constructor.name);
  }
}

class Sub extends Array {}
const holey = [1, , 3], holeyStrings = ["a", , "ab"], sparse = [];
sparse[100000] = "ab";
const named = ["a", "ab"];
named.extra = 1;
const otherPrototype = ["a", "ab"];
Object.setPrototypeOf(otherPrototype, { __proto__: Array.prototype, 5: "x" });
const grown = [];
for (let i = 0; i < 40; i++) grown.push(i % 3 ? "k" + i : i);
const arrays = {
  empty: [], ints: [0, 1, 2, 3], doubles: [0.5, 1, NaN, -0], strings: ["a", "ab", "abc", "ab-ab-4"], sameLengths: ["abc", "abe", flat("ab\u0100"), "abd"], long: [flat("x".repeat(100) + "c"), flat("x".repeat(100) + "b"), flat("\u0100".repeat(40) + "b")], ropes: [rope("ab"), "x"], flats: [flat("ab"), flat("abc")],
  mixed: [...values], holey, holeyStrings, sparse, named, otherPrototype, grown, frozen: Object.freeze(["a", "ab"]), sub: Sub.from(["a", "ab"]),
  objects: [object, other, symbol, null, true], undefineds: [undefined, "a"], nested: [[1], [2]], big: [big, 1n],
};
for (const name in arrays) {
  const array = arrays[name];
  console.log(name, values.map(value => (includes.call(array, value) ? "1" : "0")).join(""), values.map(value => indexOf.call(array, value)).join(","));
}
console.log(includes.call(arrays.strings, "ab", 2), indexOf.call(arrays.strings, "ab", 2), includes.call(arrays.strings), indexOf.call(arrays.strings), includes.call(holey), indexOf.call(holey));
for (const receiver of ["abc", { length: 2, 0: "a", 1: "ab" }, new Uint8Array([1, 2]), 5, true])
  console.log(show(receiver), includes.call(receiver, "ab"), indexOf.call(receiver, "ab"), includes.call(receiver, 2), indexOf.call(receiver, "b"));
for (const receiver of [undefined, null]) {
  try {
    includes.call(receiver, 1);
  } catch (error) {
    console.log(error.constructor.name);
  }
  try {
    indexOf.call(receiver, 1);
  } catch (error) {
    console.log(error.constructor.name);
  }
}
const methods = [["a", "ab"], [1, 2], [object]];
let found = 0;
for (let round = 0; round < 2000; round++)
  for (const array of methods) for (const name of ["includes", "indexOf"]) found += Number(array[name]("ab")) + Number(array[name](2)) + Number(array[name](object)) + Number(is(array[0], "a")) + Number(notANumber(array[1]));
console.log(found);
