// Between two pushes of a loop a call may change the list, and each iteration may have a list of its own: the storage and the length are read again.
"use strict";
class Bag {
  #list = [];
  put(value) { this.#list.push(value); }
  take() { return this.#list.pop(); }
  get size() { return this.#list.length; }
  grow(count) { for (let k = 0; k < count; k++) this.#list.push(k); return count; }
  shrink(count) { for (let k = 0; k < count; k++) this.#list.pop(); return count; }
  replace(kind) { this.#list.length = 0; this.#list.push(kind); }
  text() { return this.#list.length + ":" + this.#list.slice(-5).map(String).join(); }
}
function changed(turns) {
  const bag = new Bag();
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    bag.put(k & 7);
    if (k % 3 === 0) sum += bag.grow(k & 15);
    bag.put(1);
    sum += bag.size;
    sum += bag.shrink(k & 3);
    bag.put(2);
    if (k % 11 === 10) bag.replace(k % 2 ? "kind" : 0.5);
    sum += bag.take() === 2 ? 1 : 3;
    bag.put(k);
    sum += bag.size;
  }
  return sum + " " + bag.text();
}
function grow(list, count) { for (let k = 0; k < count; k++) list.push(k * 2); return list.length; }
function cut(list, length) { if (list.length > length) list.length = length; return list.length; }
function given(turns) {
  const list = [];
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    list.push(k);
    sum += grow(list, k & 7);
    list.push(k + 1);
    sum += cut(list, 40 - (k & 31));
    list.push(7);
    sum += list.length;
    list.pop();
    sum += list.length;
  }
  return sum + " " + list.length + " " + list.slice(-3);
}
function several(turns, count) {
  const bags = [];
  for (let k = 0; k < count; k++) bags.push(new Bag());
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    const bag = bags[k % count];
    bag.put(k);
    bag.put(k + 1);
    sum += bag.size;
    if (k % 3 === 2) { bag.take(); bag.take(); bag.take(); }
    sum += bag.size;
  }
  return sum + " " + bags.map((bag) => bag.text()).join(" ");
}
function lists(all, turns) {
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    const list = all[k % all.length];
    list.push(k);
    list.push(1);
    sum += list.length;
    list.pop();
    list.push(k * 2);
    sum += list.length;
  }
  return sum + " " + all.map((list) => list.length + ":" + list.slice(-3)).join(" ");
}
function each(bags, turns) {
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    const bag = bags[k & 1];
    bag.put(k);
    bag.put(1);
    sum += bag.size;
  }
  return sum + " " + bags.map((bag) => bag.text()).join(" ");
}
function fresh(turns) {
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    const list = [];
    list.push(k);
    list.push(2);
    sum += list.pop() + list.length;
    list.push(k & 1);
    sum += list.length;
  }
  return sum;
}
function swapped(turns) {
  let list = [], other = [1, 2, 3], sum = 0;
  for (let k = 0; k < turns; k++) {
    list.push(k);
    list.push(2);
    sum += list.length;
    if (k % 4 === 3) { const kept = list; list = other; other = kept; }
    list.push(5);
    sum += list.pop() + list.length;
  }
  return sum + " " + list.length + " " + other.length;
}
for (const turns of [0, 1, 2, 3, 10, 33, 100, 400]) console.log(turns, changed(turns), given(turns), several(turns, 1), several(turns, 3), each([new Bag(), new Bag()], turns), fresh(turns), lists([[], [1, 2], [0.5]], turns), lists([[]], turns), lists([["a"], [], [1, , 3], [{}]], turns), swapped(turns));
