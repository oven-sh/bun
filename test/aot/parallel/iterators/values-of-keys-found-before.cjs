const out = [];
const word = length => "abcdefghij".slice(0, length) + "xyz".repeat(length % 3);
class Caseless {
  constructor() {
    this.map = new Map();
  }
  has(key) {
    return this.map.has(key.toLowerCase());
  }
  get(key) {
    return this.map.get(key.toLowerCase());
  }
  set(key, value) {
    this.map.set(key.toLowerCase(), value);
  }
}
function valueOf(holder, key) {
  if (holder.has(key)) return holder.get(key);
  holder.set(key, "made " + key);
  return "new";
}
const names = new Caseless();
for (let turn = 0; turn < 3; turn++) for (let k = 0; k < 12; k++) out.push(valueOf(names, k & 1 ? word(k).toUpperCase() : word(k)));

const a = new Map();
const b = new Map();
const between = [
  () => {},
  (map, key) => map.set(key, "set"),
  (map, key) => map.delete(key),
  map => map.clear(),
  (map, key) => (map.delete(key), map.set(key, "again")),
  (map, key) => (map.delete("first"), map.set("late" + String(key), 1)),
  map => {
    for (let k = 0; k < 50; k++) map.set("grown" + k, k);
  },
  (map, key) => b.set(key, "other"),
  (map, key) => b.has(key),
  map => {
    for (const key of [...map.keys()].slice(0, 20)) map.delete(key);
  },
  () => {
    let kept = [];
    for (let k = 0; k < 20000; k++) kept.push({ k }, "text" + k);
    globalThis.kept = kept.length;
  },
];
function look(map, key, change) {
  const found = map.has(key);
  change(map, key);
  return found + " " + map.get(key);
}
for (const change of between) {
  a.clear();
  b.clear();
  a.set("first", "one");
  for (let k = 0; k < 6; k++) {
    const key = word(k) + (k & 1 ? "" : "");
    a.set(word(k), { k });
    out.push(look(a, key, change), look(a, word(k + 1), change), look(b, key, change), look(a, "absent" + k, change));
  }
  for (const key of [1, 0.5, -0, NaN, null, undefined, true, 7n, between, Symbol.iterator]) {
    a.set(key, "of key");
    out.push(look(a, key, change).replace("[object Object]", "object"));
  }
}
const set = new Set(["x", word(4)]);
const beside = new Map([["x", "map"], [word(4), "map too"]]);
for (const key of ["x", word(4), "y"]) out.push(set.has(key), beside.get(key), beside.has(key), set.has(key), beside.get(key));
class Heir extends Map {
  get(key) {
    return "heir " + super.get(key);
  }
}
const heir = new Heir([["k", 1]]);
out.push(heir.has("k"), heir.get("k"), Map.prototype.get.call(heir, "k"));
const values = new Map();
for (let k = 0; k < 40; k++) values.set("n" + k, k & 1 ? k * 0.5 : "v" + k);
for (let k = 0; k < 45; k++) out.push(values.has("n" + k) ? values.get("n" + k) : "none");
console.log(out.map(String).join("\n"));
