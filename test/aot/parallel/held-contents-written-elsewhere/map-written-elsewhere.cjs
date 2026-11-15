"use strict";
class Box {
  constructor(v) {
    this.v = v;
  }
}
class Store {
  constructor() {
    this.values = new Map();
    this.items = [];
    this.found = null;
    this.picked = null;
    this.front = null;
  }
  put(key, at) {
    this.values.set(key, new Box(key));
    this.items[at] = new Box(at);
  }
  take(key) {
    this.found = this.values.get(key);
    return this.found;
  }
  pick(at) {
    this.picked = this.items[at];
    return this.picked;
  }
  get best() {
    return this.items[0];
  }
  look() {
    this.front = this.best;
    return this.front;
  }
  sum() {
    let total = 0;
    for (const box of [this.found, this.picked, this.front]) total += box ? (box.v ?? 100) : 1000;
    return total;
  }
}
function show(store) {
  console.log(String(store.found), String(store.picked), String(store.front), store.sum());
}
const name = process.argv[5] ?? "kept";
const store = new Store();
store.put(1, 0);
store.put(2, 1);
globalThis[name] = store;
store.take(1);
store.pick(1);
store.look();
show(store);

const other = globalThis[name];
for (const value of ["text", 7, 2.5, true, null, undefined, Symbol("s"), 10n, [1], { v: 3 }, () => 4]) {
  other.values.set(2, value);
  other.items[0] = value;
  store.take(2);
  store.look();
  other.pick(0);
  show(store);
}
for (const key of ["length", "0", "push", -1, 1.5, Symbol.iterator]) {
  other.pick(key);
  show(store);
}
