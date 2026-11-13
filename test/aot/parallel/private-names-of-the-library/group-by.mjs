// Built-in functions that call members of Map, Set, String and Array under private names.
const lines = [];
const show = (label, make) => {
  try {
    const value = make();
    lines.push(label + " " + (value instanceof Map ? JSON.stringify([...value].map(([k, v]) => [Object.is(k, -0) ? "-0" : typeof k === "symbol" ? "symbol" : typeof k === "object" && k ? "object" : k, v])) : JSON.stringify(value)));
  } catch (e) {
    lines.push(label + " " + e.constructor.name + " " + e.message);
  }
};
const items = Array.from({ length: 30 }, (_, i) => ({ id: i, kind: "k" + (i % 4), price: (i * 17) % 23 }));
const key = { key: 1 }, symbol = Symbol("s");
function all(label) {
  for (let round = 0; round < 50; round++) {
    lines.length = label ? lines.length : 0;
    show(label + "numbers", () => Map.groupBy(items, item => item.price % 3));
    show(label + "strings", () => Map.groupBy(items, item => item.kind).size);
    show(label + "zeros", () => Map.groupBy([0, -0, NaN, NaN, "1", null, undefined], x => x));
    show(label + "objects", () => Map.groupBy([1, 2, 3], n => (n % 2 ? key : symbol)));
    show(label + "indexes", () => Map.groupBy("abcabc", (c, i) => i % 2));
    show(label + "set", () => Map.groupBy(new Set([3, 1, 2]), x => x > 1));
    show(label + "generator", () => Map.groupBy((function* () { yield* [1, 2, 3, 4]; })(), x => x % 2 === 0));
    show(label + "object", () => Object.groupBy(items, item => item.kind).k1.length);
    show(label + "throws", () => Map.groupBy(items, item => { if (item.id === 5) throw new RangeError("five"); return 1; }));
    show(label + "no list", () => Map.groupBy(null, x => x));
    show(label + "no callback", () => Map.groupBy([], 5));
    show(label + "no iterator", () => Map.groupBy({}, x => x));
    if (label) break;
  }
}
all("");
console.log(lines.join("\n"));
lines.length = 0;

class MyMap extends Map {
  get(k) {
    return "mine " + super.get(k);
  }
}
const mine = new MyMap([[1, 2]]);
console.log(mine.get(1), MyMap.groupBy([1], x => x) instanceof MyMap, new Set([1, 2]).union(new Set([3])).size, new Set([1]).isSubsetOf(new Map([[1, 1]])));
