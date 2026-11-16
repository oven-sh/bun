// Descriptions of symbols in loops and out of them; values that weak maps hold already are replaced, over collections too.
const list = [Symbol("a"), Symbol("bb"), Symbol(), Symbol(""), Symbol.for("registered"), Symbol.iterator, Symbol("日本"), Symbol("x".repeat(60))];
const own = { description: "own" };
const others = [Object(Symbol("boxed")), own, "text", 5, null, undefined, { get description() { return 7; } }, class { static description = "static"; }, Object.create(Object(Symbol("above")))];
function lengths(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) n += list[k & 1].description.length;
  return n;
}
function read(s) {
  return s.description;
}
function readIfSymbol(s) {
  return typeof s === "symbol" ? s.description : "no";
}
function each(values) {
  let out = "";
  for (const s of values) {
    try {
      out += String(s.description) + "|";
    } catch (error) {
      out += error.constructor.name + "|";
    }
  }
  return out;
}
console.log(lengths(1000), each(list), each(others));
for (const s of [...list, ...others]) {
  try {
    console.log(String(read(s)), String(readIfSymbol(s)), typeof s === "symbol" ? read(s) === read(s) : 0);
  } catch (error) {
    console.log(error.constructor.name);
  }
}
for (const s of list) console.log(s.toString(), Object(s).description, `${s.description}`, s?.description?.length);
Bun.gc(true);
console.log(each(list), lengths(7));

const weak = new WeakMap();
const keys = [{}, {}, () => 1, [], Symbol("key"), {}];
function fill(turns, make) {
  let n = 0;
  for (let k = 0; k < turns; k++) {
    const key = keys[k % keys.length];
    const answer = weak.set(key, make(k));
    if (answer === weak) n++;
    const held = weak.get(key);
    n += typeof held === "number" ? held : held === undefined ? 100 : held?.k ?? held?.length ?? 1000;
  }
  return n;
}
console.log(fill(60, (k) => k));
console.log(fill(600, (k) => ({ k, list: [k] })));
Bun.gc(true);
console.log(keys.map((key) => weak.get(key).list[0]).join());
console.log(fill(60, (k) => (k & 1 ? "text" + k : undefined)), fill(60, (k) => (k % 3 ? [k] : k / 2)), fill(12, () => null && 1) || "none");
const many = Array.from({ length: 300 }, (_, i) => ({ i }));
for (let round = 0; round < 4; round++) {
  for (const key of many) weak.set(key, round ? [weak.get(key), key.i] : key.i);
  if (round === 1) for (const key of many) if (key.i % 3 === 0) weak.delete(key);
  if (round & 1) Bun.gc(true);
}
console.log(many.filter((key) => weak.has(key)).length, JSON.stringify(weak.get(many[7])), JSON.stringify(weak.get(many[9])), weak.get(many[0]) === undefined);
console.log(weak.set(many[0], 1).set(many[1], 2).get(many[0]), weak.get(many[1]));
for (const bad of [1, "s", null, undefined, Symbol.for("registered"), 1n]) {
  try {
    console.log(weak.set(bad, 1) === weak);
  } catch (error) {
    console.log(error.constructor.name);
  }
}
for (const notMap of [new Map(), {}, null]) {
  try {
    console.log(typeof WeakMap.prototype.set.call(notMap, {}, 1));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
class Heir extends WeakMap {
  set(key, value) {
    return super.set(key, value + 1);
  }
}
const heir = new Heir();
const at = {};
for (let k = 0; k < 10; k++) heir.set(at, k);
console.log(heir.get(at), heir.has({}), heir.set(at, 5) === heir);
