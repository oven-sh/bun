// One test of a list answers for int32s and for any values, where elements are popped, shifted and stored in loops. The list changes its kind amid the loop.
// STATISTIC: BoxedListsTestedOnce >= 2
"use strict";
class Extended extends Array {}
function sparse() { const list = [1, 2, 3]; list[5000] = 4; return list; }
function fixedLength() { const list = [1, 2, 3]; Object.defineProperty(list, "length", { writable: false }); return list; }
class Holder {
  #list; constructor(list) { this.#list = list; }
  pop() { return this.#list.pop(); }
  shift() { return this.#list.shift(); }
  put(key, value) { this.#list[key] = value | 0; }
  get size() { return this.#list.length; }
}
const kinds = [() => [1, 2, 3, 4, 5], () => [1, "two", {}, null, 5], () => [1.5, 2, 3.25], () => [], () => [1, , 3], () => [1.5, , 2], () => ["a", , "c"], () => new Array(4), () => new Array(4).fill(7), () => new Array(4).fill(.5), () => Object.freeze([1, 2, 3]), () => Object.seal([1, 2, 3]),
  () => Object.preventExtensions([1, 2, 3]), sparse, fixedLength, () => new Extended(1, 2, 3), () => Extended.from([1, "b", 2.5]), () => [NaN, -0, 2147483647], () => [1n, [2], true], () => JSON.parse("[1,2,3]"), () => "abc".split(""), () => [1, 2, 3].map(x => x * 2)];
const changes = [() => {}, list => list.push("late"), list => list.push(.25), list => { list[list.length] = 3; }, list => { list.length = 1; }, list => { list[list.length + 2] = 9; }, list => Object.freeze(list), list => list.unshift(8), list => { list.extra = 1; }, list => Object.defineProperty(list, "0", { get() { return 11; }, configurable: true })];
const show = value => typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "{" + Object.keys(value).length + "}" : typeof value + ":" + String(value);
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
function pops(list, turns, change, at) {
  const holder = new Holder(list), taken = [];
  for (let turn = 0; turn < turns; turn++) {
    if (turn === at) change(list);
    taken.push(show(holder.pop()));
    if (turn & 1) taken.push(show(holder.shift()));
    else taken.push(show(list.pop()));
  }
  return taken.join() + " " + holder.size;
}
function stores(list, turns, change, at) {
  const holder = new Holder(list);
  let last = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === at) change(list);
    holder.put(turn & 3, turn * 7);
    list[turn & 1] = turn;
    last = list[turn & 3];
  }
  return show(last) + " " + holder.size + " " + Array.prototype.slice.call(list, 0, 8).map(show).join();
}
for (let k = 0; k < kinds.length; k++) {
  for (let c = 0; c < changes.length; c++) {
    const at = (k + c) % 4;
    console.log(k, c, attempt(() => pops(kinds[k](), 6, changes[c], at)), "|", attempt(() => stores(kinds[k](), 6, changes[c], at)));
  }
}
