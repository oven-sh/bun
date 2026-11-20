// The groups of Object.groupBy and Map.groupBy are arrays that nobody else has before they are returned.
const log = [];
const elements = [1, 2.5, "text", null, undefined, { a: 1 }, [3], true, 7n, -0, NaN];
for (const list of [elements, [1, 2, 3, 4, 5], [1.5, 2.5], ["a", "bb", "a"], [], [, 1, ,], new Set([1, "a", 2]), "abca", new Map([[1, 2], [3, 4]])]) {
  const groups = Object.groupBy(list, (x, k) => (typeof x === "number" ? (x & 1 ? "odd" : "even") : typeof x) + (k > 6 ? k : ""));
  log.push(Object.getPrototypeOf(groups), Object.keys(groups).join(), Object.values(groups).map(group => group.length + ":" + group.map(x => (typeof x === "symbol" ? "s" : Object.is(x, -0) ? "-0" : String(x)))).join("|"));
  const byKey = Map.groupBy(list, x => x);
  log.push([...byKey].map(([key, group]) => String(key) + "=" + group.length).join());
}
const names = Object.groupBy([1, 2, 3, 4], x => ["__proto__", "constructor", "0", "length"][x - 1]);
log.push(Object.keys(names).join(), names.__proto__.length, names[0][0], names.length[0]);
const symbol = Symbol("s");
const keys = [symbol, { toString: () => "name" }, 1.5, -0, null, undefined, true];
const odd = Object.groupBy([0, 1, 2, 3, 4, 5, 6, 0, 1], x => keys[x]);
log.push(odd[symbol].length, odd.name.length, odd[1.5][0], odd[0][0], odd.null[0], odd.undefined[0], odd.true[0]);
for (let k = 0; k < 3; k++) {
  const big = Object.groupBy(Array.from({ length: 50 }, (_, i) => (k === 1 ? i / 4 : k === 2 ? "t" + i : i)), (x, i) => i % 7);
  log.push(Object.values(big).map(group => group.length + String(group[group.length - 1])).join());
  big[0].push("more");
  big[1].length = 0;
  log.push(big[0].length, big[1].length, Array.isArray(big[2]));
}
let seen = 0;
try { Object.groupBy([1, 2, 3], x => { seen += x; if (x === 2) throw new Error("stop"); return x; }); } catch (error) { log.push(error.message, seen); }
try { Map.groupBy([1], 5); } catch (error) { log.push(error.constructor.name); }
console.log(log.map(String).join("\n"));
