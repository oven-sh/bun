// WeakMap.prototype.set in loops under objects, functions, lists, symbols, proxies and what is no key; its answer is the map.
const out = [];
const keys = [{}, [], () => 1, Symbol("s"), new Date(0), new Proxy({}, {}), class {}, new Map(), /x/, Object.freeze({ f: 1 })];
const weak = new WeakMap();
function store(turns) {
  let total = 0, same = 0;
  for (let turn = 0; turn < turns; turn++) {
    const key = keys[turn % keys.length];
    if (weak.set(key, turn % 3 ? turn : { turn }) === weak) same++;
    const value = weak.get(key);
    total += typeof value === "number" ? value : value.turn;
    if (turn % 7 === 6) weak.delete(key);
  }
  return total + "/" + same;
}
out.push(store(4), store(100), keys.map((key) => weak.has(key)).join());
const records = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }];
function count(turns) {
  const counts = new WeakMap();
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    const record = records[turn & 3];
    counts.set(record, (counts.get(record) ?? 0) + record.n).set(records[0], 0.5);
    total += counts.get(record);
  }
  return total;
}
out.push(count(1), count(2), count(90));
for (const key of [1, "text", null, undefined, Symbol.for("registered"), 1n, true]) {
  try {
    for (let turn = 0; turn < 3; turn++) weak.set(key, turn);
    out.push("stored");
  } catch (error) {
    out.push(error.constructor.name);
  }
}
class Counted extends WeakMap {
  sets = 0;
  set(key, value) {
    this.sets++;
    return super.set(key, [value]);
  }
}
const counted = new Counted();
for (let turn = 0; turn < 9; turn++) counted.set(records[turn & 3], turn);
out.push(counted.sets, records.map((record) => counted.get(record)).join());
const large = new WeakMap(), many = Array.from({ length: 3000 }, (_, i) => ({ i }));
let sum = 0;
for (const key of many) large.set(key, key.i);
for (const key of many) large.set(key, large.get(key) * 2);
for (const key of many) sum += large.get(key);
out.push(sum);
console.log(out.join("\n"));
