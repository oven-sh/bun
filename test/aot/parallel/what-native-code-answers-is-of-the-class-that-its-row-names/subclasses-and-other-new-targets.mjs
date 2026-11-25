const said = [];
const kind = (v) => (v === null ? "null" : typeof v !== "object" && typeof v !== "function" ? typeof v : Object.prototype.toString.call(v).slice(8, -1) + ":" + (v.constructor?.name ?? "none"));
class Rows extends Array {} class Day extends Date {} class Bag extends Set {} class Book extends Map {} class Later extends Promise {} class Pattern extends RegExp {} class Bytes extends Uint8Array {} class Store extends ArrayBuffer {} class Oops extends Error {}
function Other() {} Other.prototype = { tag: "other" };
for (let turn = 0; turn < 100; turn++) { said.length = 0;
  said.push(kind(Array.of.call(Rows, 1, 2)), kind(Array.from.call(Rows, [1])), kind(Rows.of(1)), kind(new Rows(3)), kind(new Day(0)), kind(new Bag([1])), kind(new Book([[1, 2]])), kind(new Pattern("a")), kind(new Bytes(2)), kind(new Store(4)), kind(new Oops("x")));
  said.push(kind(Reflect.construct(Date, [0], Other)), kind(Reflect.construct(Array, [2], Other)), kind(Reflect.construct(Set, [], Other)), kind(Reflect.construct(Map, [], Other)), kind(Reflect.construct(RegExp, ["a"], Other)), kind(Reflect.construct(Uint8Array, [2], Other)), kind(Reflect.construct(Error, ["m"], Other)), kind(Reflect.construct(Promise, [() => {}], Other)));
  said.push(kind(Later.resolve(1)), kind(Later.resolve(1).then(() => 2)), kind(Later.all([])), kind(new Bytes(4).subarray(1)), kind(new Bytes(4).slice(1)), kind(new Bytes(4).map((x) => x)), kind(new Store(8).slice(2)), kind(new Rows(1, 2, 3).slice(1)), kind(new Rows(1, 2, 3).concat([4])), kind(new Pattern("a", "g")[Symbol.matchAll]("aa")), kind("a1".split(new Pattern("1"))));
}
console.log(said.join(" "));
