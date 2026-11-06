// new Map(pairs) for lists of every size and sort: keys that are strings (also the same text twice, made in two ways), keys of other sorts, values of every sort, and pairs that are no ordinary arrays.
const say = (...values) => console.log(...values);
const show = map => [...map].map(([key, value]) => String(typeof key === "symbol" ? "symbol" : key) + "=" + (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value))).join();
for (const size of [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 63, 64, 65, 254, 255, 256, 600, 3000]) {
  const pairs = [];
  for (let i = 0; i < size; i++) pairs.push(["key" + i, i % 3 ? "value" + i : i]);
  for (const pair of pairs) pair[0].charCodeAt(0);
  const map = new Map(pairs);
  let right = map.size === size;
  for (let i = 0; i < size; i++) right &&= map.get("key" + i) === (i % 3 ? "value" + i : i) && map.has("k" + "ey" + i);
  say(size, right, map.has("key" + size), [...map.keys()].slice(0, 3).join(), [...map.values()].slice(-2).join());
  map.set("more", 1); map.delete("key0"); say(map.size, map.get("more"), map.has("key0"), [...map.keys()].at(-1));
}
const twice = "a" + String.fromCharCode(98);
twice.charCodeAt(0);
say(show(new Map([["ab", 1], ["c", 2], [twice, 3], ["c", 4], ["d", 5]])), new Map([["ab", 1], [twice, 3]]).size);
const many = []; for (let i = 0; i < 400; i++) many.push([String(i % 37), i]); for (const pair of many) pair[0].charCodeAt(0);
say(show(new Map(many)).length, new Map(many).size, new Map(many).get("36"), [...new Map(many).keys()].slice(0, 4).join());
say(show(new Map([["a", undefined], ["b", null], ["c", true], ["d", false], ["e", 0], ["f", -0], ["g", 1.5], ["h", NaN], ["i", 10n], ["j", "text"], ["k", { x: 1 }], ["l", [1]], ["m", 2 ** 40]])));
say(Object.is(new Map([["f", -0]]).get("f"), -0), typeof new Map([["s", Symbol.iterator]]).get("s"), new Map([["f", say]]).get("f") === say);
say(show(new Map([["a", 1], [1, 2], ["b", 3]])), show(new Map([[{}, 1], ["a", 2]])), show(new Map([[-0, 1], [0, 2], [NaN, 3], [NaN, 4]])), show(new Map([[undefined, 1], [null, 2], [true, 3]])), show(new Map([[Symbol.iterator, 1], ["a", 2]])));
say(show(new Map([["x" + "y".repeat(3), 1], ["left".concat("right"), 2], ["substring-of-more".slice(0, 9), 3], ["substring", 4]])));
say(show(new Map([["a", 1, "ignored"], ["b", 2, 3, 4]])), show(new Map([["a"], ["b", 2]])), show(new Map([[], ["b", 2]])));
const holey = [["a", 1], , ["b", 2]]; try { say(show(new Map(holey))); } catch (e) { say(e.name); }
const pairWithHole = ["a", 1]; delete pairWithHole[1]; say(show(new Map([pairWithHole, ["b", 2]])));
for (const wrong of [[1], ["ab"], [null], [undefined], [["a", 1], 2]]) try { say(show(new Map(wrong))); } catch (e) { say(e.name); }
class Pair extends Array {} const derived = Pair.from(["a", 1]); say(show(new Map([derived, ["b", 2]])));
const withGetter = ["a", 1]; Object.defineProperty(withGetter, 1, { get() { say("getter runs"); return 9; } }); say(show(new Map([["z", 0], withGetter])));
say(show(new Map([{ 0: "a", 1: 1 }, ["b", 2]])), show(new Map([["a", 1]].values())), show(new Map(new Map([["a", 1], ["b", 2]]))), show(new Map(Object.entries({ x: 1, y: "two", 3: [3] }))));
class Counting extends Map { set(key, value) { return super.set(key, value + 1); } } say(show(new Counting([["a", 1], ["b", 2]])));
const kept = [["a", { n: 1 }]]; const holding = new Map(kept); kept[0][1].n = 2; kept[0][1] = "changed"; kept.push(["b", 1]); say(show(holding));
let total = 0; for (let round = 0; round < 300; round++) { const list = []; for (let i = 0; i < 40; i++) list.push(["k" + ((i * 7 + round) % 23), { round, i }]); for (const pair of list) pair[0].charCodeAt(0); const map = new Map(list); total += map.size + map.get("k" + (round % 23)).i; } say(total);
