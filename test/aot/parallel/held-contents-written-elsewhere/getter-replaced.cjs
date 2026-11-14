"use strict";
class Box {
  constructor(v) {
    this.v = v;
  }
}
class Store {
  constructor() {
    this.items = [new Box(1)];
    this.front = null;
  }
  get best() {
    return this.items[0];
  }
  look() {
    this.front = this.best;
    return this.front;
  }
  read() {
    const front = this.front;
    return front && front.v;
  }
}
const name = process.argv[5] ?? "kept";
const store = new Store();
globalThis[name] = store;
store.look();
console.log(store.read());
const above = Object.getPrototypeOf(globalThis[name]);
for (const value of ["text", 5, undefined, { v: 9 }, [2]]) {
  Object.defineProperty(above, "best", { get: () => value, configurable: true });
  store.look();
  console.log(String(store.front), store.read());
}
Object.defineProperty(above, "best", { value: "plain", configurable: true });
store.look();
console.log(String(store.front), store.read());
Object.defineProperty(store, "best", { value: 11, configurable: true });
store.look();
console.log(String(store.front), store.read());
