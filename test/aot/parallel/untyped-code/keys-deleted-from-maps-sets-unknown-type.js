// Map.prototype.delete and Set.prototype.delete on receivers and keys whose types the compiler does not know: the answer, size, order, keys that come back, walks that are under way, other receivers
const said = [];
const text = value => typeof value === "object" && value !== null ? "{" + Object.values(value).join(",") + "}" : typeof value === "symbol" ? value.description : Object.is(value, -0) ? "-0" : String(value);
const drop = (collection, key) => collection.delete(key);
const list = map => [...map].map(([key, value]) => text(key) + "=" + text(value)).join(" "), members = set => [...set].map(text).join(" ");
const show = (label, result) => said.push(label + ": " + result);
const objects = Array.from({ length: 300 }, (_, i) => ({ i })), symbols = Array.from({ length: 300 }, (_, i) => Symbol("s" + i));
const kinds = {
  strings: i => "k" + i, longer: i => "a key that is a good deal longer than sixteen characters " + i, numbers: i => i * 7, negative: i => -i - 1, halves: i => i + 0.5,
  objects: i => objects[i], symbols: i => symbols[i], bigints: i => BigInt(i) * 10n ** 20n, copies: i => ("c" + i).split("").join(""), parts: i => ("<<p" + i + ">>").slice(2, -2),
};

for (const [kind, key] of Object.entries(kinds)) {
  for (const n of [1, 3, 4, 5, 8, 9, 15, 16, 17, 63, 64, 65, 255, 256, 300]) {
    const map = new Map(), set = new Set();
    for (let i = 0; i < n; i++) { map.set(key(i), i); set.add(key(i)); }
    let dropped = 0, missed = 0;
    for (let i = 0; i < n + 3; i += 3) { dropped += (drop(map, key(i)) ? 1 : 0) + (drop(set, key(i)) ? 1 : 0); missed += (drop(map, key(i)) ? 1 : 0) + (drop(set, key(i)) ? 1 : 0); }
    let found = 0;
    for (let i = 0; i < n; i++) found += (map.has(key(i)) ? 1 : 0) + (set.has(key(i)) ? 1 : 0);
    show(kind + " " + n, [dropped, missed, found, map.size, set.size, n <= 17 ? list(map) + " | " + members(set) : text([...map.keys()].pop())].join(" "));
    for (let i = 0; i < n; i += 3) { map.set(key(i), "back"); set.add(key(i)); }
    show(kind + " " + n + " back", [map.size, set.size, text([...map.keys()].pop()), text([...set].pop()), map.get(key(0))].join(" "));
  }
  const moving = new Map(), ring = new Set();
  for (let i = 0; i < 20; i++) { moving.set(key(i), i); ring.add(key(i)); }
  for (let round = 0; round < 500; round++) { const k = key(round % 20); if (!drop(moving, k) || !drop(ring, k)) show(kind, "a key was not there"); moving.set(k, round); ring.add(k); }
  show(kind + ": deleted and added over and over", [moving.size, ring.size, text([...moving.keys()][0]), [...moving.values()].slice(0, 3).join(",")].join(" "));
  const walked = new Set(); for (let i = 0; i < 30; i++) walked.add(key(i));
  const seen = []; let at = 0;
  for (const k of walked) { seen.push(text(k)); drop(walked, key(at + 1)); at += 2; }
  show(kind + ": deleted under a walk", seen.length + " " + walked.size + " " + seen[seen.length - 1]);
}
{
  const map = new Map(), set = new Set();
  const keys = [0, NaN, 1, "1", true, null, undefined, "", 2 ** 31, -(2 ** 31), 2 ** 32, 2 ** 53, 1e300, Infinity, 10n, "ab"];
  for (const key of keys) { map.set(key, typeof key); set.add(key); }
  const same = [-0, 0 / 0, 1.0, "1", true, null, undefined, "", 2147483648, -2147483648, 4294967296, 9007199254740992, 1e300, 1 / 0, 5n + 5n, "a" + "b"];
  show("keys that are the same", same.map(key => drop(map, key) + "" + drop(set, key)).join(" ") + " " + map.size + " " + set.size);
  show("an empty map and set", [drop(new Map(), 1), drop(new Set(), "a"), drop(new Map(), {}), drop(map, 0), drop(set, NaN)].join(" "));
}
{
  class Counting extends Map { delete(key) { Counting.calls++; return super.delete(key); } }
  Counting.calls = 0;
  const counting = new Counting([[1, 1], [2, 2]]);
  class Plain extends Set {}
  const plain = new Plain(["a", "b"]);
  const own = new Map([[1, 1]]); own.delete = function (key) { return "own " + key; };
  const other = new Set([3]); Object.setPrototypeOf(other, { delete: key => "other " + key });
  show("delete of their own", [drop(counting, 1), drop(counting, 3), Counting.calls, counting.size, drop(plain, "a"), plain.size, drop(own, 1), own.size, drop(other, 3)].join(" "));
  const weak = new WeakMap([[objects[0], 1]]), weakSet = new WeakSet([objects[1]]);
  show("weak ones", [drop(weak, objects[0]), drop(weak, objects[0]), drop(weakSet, objects[1]), drop(weakSet, 1)].join(" "));
  const mapDelete = Map.prototype.delete, setDelete = Set.prototype.delete;
  for (const receiver of [{}, [], new Set([1]), new Map([[1, 1]]), new Proxy(new Map(), {}), null, undefined, 1, "text"]) {
    for (const [name, method] of [["map", mapDelete], ["set", setDelete]]) {
      try { show(name + " delete on " + Object.prototype.toString.call(receiver), method.call(receiver, 1)); } catch (error) { show(name + " delete on " + Object.prototype.toString.call(receiver), error.constructor.name); }
    }
  }
  show("no key and more keys", [drop(new Map([[undefined, 1]])), new Set([undefined]).delete(), new Map([[1, 1]]).delete(1, 2, 3)].join(" "));
}
console.log(said.join("\n"));
