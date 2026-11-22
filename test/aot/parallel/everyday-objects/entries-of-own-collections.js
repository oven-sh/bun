// A class over a Map that is iterable and has entries, keys and forEach
class Table {
  #rows = new Map();
  add(key, value) {
    this.#rows.set(key, (this.#rows.get(key) || 0) + value);
    return this;
  }
  *entries() {
    for (const [key, value] of this.#rows) if (value) yield [key, value];
  }
  [Symbol.iterator] = () => this.entries();
  forEach(call) {
    for (const [key, value] of this) call(value, key, this);
  }
}
function sum(n) {
  const table = new Table().add("a", n).add("b", 0).add("a", n + 1).add("c", -n);
  const out = [];
  table.forEach((value, key, all) => out.push(key + value + (all === table)));
  return out.join() + " " + JSON.stringify(Object.fromEntries(table));
}
console.log(sum(1));
console.log(sum(20));
console.log(sum(0));
