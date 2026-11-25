// Built-ins that are called with an argument that is undefined or an object of one of several kinds.
class Item { constructor(n) { this.count = n; } get twice() { return this.count * 2; } }
class Box { constructor(n) { this.items = [new Item(n)]; } [Symbol.iterator]() { return this.items[Symbol.iterator](); } }
class Counting { constructor(n) { this.left = n; } [Symbol.iterator]() { return { next: () => ({ done: this.left-- <= 0, value: new Item(this.left) }) }; } }
const byKey = new Map([["set", new Set([new Item(1), new Item(2)])], ["array", [new Item(3)]], ["map", new Map([[1, new Item(4)]])], ["box", new Box(5)], ["counting", new Counting(2)], ["text", "ab"], ["number", 7], ["null", null], ["like", { length: 1, 0: new Item(6) }], ["frozen", Object.freeze([new Item(8)])], ["holes", [, new Item(9)]], ["proxy", new Proxy([new Item(10)], {})]]);
const show = value => value instanceof Item ? `Item${value.twice}` : Array.isArray(value) ? `[${value.map(show)}]` : typeof value;
const calls = [x => Array.from(x), x => Array.from(x, v => v && v.count), x => [...new Set(x)], x => Object.values(x), x => Object.assign({}, x), x => [].concat(x), x => Array.of(x), x => [...x], x => new Array(x), x => Object.keys(x).join()];
for (const key of [...byKey.keys(), "none"]) {
  let line = key;
  for (const call of calls) {
    let answer;
    try { answer = show(call(byKey.get(key))); } catch (error) { answer = error.constructor.name; }
    line += " " + answer;
  }
  console.log(line);
}
for (const item of byKey.get("set")) item.count += 100;
console.log(show(Array.from(byKey.get("set"))), show(Array.from(byKey.get("array"))));
