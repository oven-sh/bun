// list.push(...source) appends the elements of the source to the list and allocates no copy of the source.
// STATISTIC: SpreadCallArrayCopiesElided >= 8
"use strict";
class Bag {
  #items = [];
  constructor(...items) { this.#items.push(...items); }
  add(...items) { return this.#items.push(...items); }
  twice() { this.#items.push(...this.#items); return this; }
  get text() { return this.#items.length + ":" + this.#items.map((item) => typeof item + " " + String(item)).join(); }
}
function append(out, lists) {
  for (const list of lists) out.push(...list);
  return out;
}
function appendRest(out, ...rest) {
  out.push(...rest);
  return out;
}
const show = (list) => list.length + ":" + Array.from(list.slice(0, 12), (item, k) => (k in list ? typeof item : "hole") + " " + String(item) + (Object.is(item, -0) ? "-" : "")).join();
for (let k = 0; k < 40; k++) {
  const bag = new Bag(k, k + 1, k * 2);
  console.log(bag.text, bag.add(), bag.add(k / 2), bag.add("s" + k, null), bag.twice().text, bag.twice().text.length, new Bag().twice().text, new Bag(...[k, , k]).text);
  const own = [k, 1];
  own.push(...own);
  own.push(...own, k);
  console.log(show(own), show(appendRest([k], 1, 2.5, "x")), show(appendRest([0.5], k)), show(appendRest([], own, undefined).slice(1)));
  console.log(show(append([], [[1, 2], [], [0.5, -0], ["a"], [1, , 3], [, ,], [null, undefined]])), show(append([0.5], [[k], [k + 0.25], [NaN, , 1.5]])), show(append([1, , 3], [[4], own])));
}
const big = Array.from({ length: 70000 }, (_, k) => k), small = [1, 2, 3];
console.log(append([], [big]).length, show(append([], [big])), append([0.5], [big, small]).length, show(append(small, [small, small])), append(big, [big]).length, big[139999]);
const tries = [
  () => append(Object.freeze([1]), [[2]]), () => append(Object.freeze([1]), [[]]), () => append(Object.preventExtensions([1]), [[2]]), () => append(Object.defineProperty([1], "length", { writable: false }), [[2]]),
  () => append(Object.assign([7], { push(...values) { return this.unshift(...values); } }), [[8, 9], [10]]), () => append({ push(...values) { this.last = values; }, length: 2 }, [[8, 9]]).last, () => append([], ["abc", new Set([1, 2]), new Uint8Array(2)]),
  () => append([], [[1], null]), () => append(null, [[1]]), () => append(undefined, [[1]]), () => append("text", [[1]]),
  () => append([], [Object.assign([1, 2], { *[Symbol.iterator]() { yield "own"; } })]),
];
for (const attempt of tries) for (let k = 0; k < 3; k++) {
  try { const value = attempt(); console.log(Array.isArray(value) ? show(value) : value); } catch (error) { console.log(error.constructor.name); }
}
