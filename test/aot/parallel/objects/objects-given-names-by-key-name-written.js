// Objects are given their names by key, one name after another, from lists that come once, twice and many times, and in sizes at which an object changes the way it keeps its names.
// Whatever way that is, the order of the names, each value, and all that is done to the object later are those of an object whose names were written out.
// Env: BUN_JSC_collectContinuously=1
// Env: BUN_JSC_forceDidDeferGCWork=1
function fresh(text) {
  return JSON.parse(JSON.stringify({ text })).text;
}
function namesOf(list, count) {
  const names = [];
  for (let k = 0; k < count; k++) names.push(fresh("n" + list + "_" + k * 3));
  return names;
}
function fill(object, names, from = 0) {
  for (let k = 0; k < names.length; k++) object[names[k]] = from + k;
  return object;
}
function describe(object) {
  let text = "";
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const flags = (descriptor.writable ? "w" : "") + (descriptor.enumerable ? "e" : "") + (descriptor.configurable ? "c" : "");
    text += String(key) + "=" + ("value" in descriptor ? String(descriptor.value) : "get:" + String(object[key])) + ":" + flags + ";";
  }
  return text;
}
function digest(text) {
  let sum = 0;
  for (let k = 0; k < text.length; k++) sum = (sum * 31 + text.charCodeAt(k)) % 1000000007;
  return text.length + ":" + sum;
}
function listed(object) {
  let byForIn = "";
  for (const name in object) byForIn += name + ",";
  return digest(byForIn) + " " + digest(Object.keys(object).join()) + " " + digest(JSON.stringify(object) ?? "none") + " " + digest(Object.entries(object).join());
}
const sizes = [1, 2, 5, 6, 7, 8, 9, 10, 11, 16, 17, 32, 33, 64, 65, 127, 128, 129, 130, 200, 256, 257, 600];
const prototypes = { none: null, object: Object.prototype, other: { inherited: 1, n0_3: "above" } };

console.log("# lists of every size, each once, twice and five times");
for (const size of sizes) {
  for (const which in prototypes) {
    let line = size + " " + which + ":";
    for (const times of [1, 2, 5]) {
      const names = namesOf(size + "x" + times + which, size);
      let last;
      for (let time = 0; time < times; time++) last = fill(Object.create(prototypes[which]), names);
      line += " " + digest(describe(last)) + " " + listed(last);
    }
    console.log(line);
  }
}

console.log("# names that are no plain names");
const odd = ["0", "7", "07", "7th", "4294967294", "4294967295", "-1", "1.5", "1e3", "", " ", "then", "__proto__", "constructor", "toString", "valueOf", "hasOwnProperty", "length", "ķth", "中文", "😀", "a\u0000b"];
for (const size of [0, 3, 7, 40, 140]) {
  for (const which in prototypes) {
    for (const name of odd) {
      const object = fill(Object.create(prototypes[which]), namesOf("odd" + size, size));
      object[fresh("x" + name).slice(1)] = "odd";
      object[fresh("after")] = "after";
      console.log(size, which, JSON.stringify(name), digest(describe(object)), listed(object), Object.getPrototypeOf(object) === prototypes[which]);
    }
  }
}
for (const size of [0, 3, 40, 140]) {
  const object = fill({}, namesOf("proto" + size, size));
  const above = { fromAbove: size };
  object[fresh("__proto__")] = above;
  object[fresh("after")] = 1;
  console.log(size, "__proto__ takes an object:", Object.getPrototypeOf(object) === above, object.fromAbove, Object.hasOwn(object, "__proto__"), digest(describe(object)));
}

console.log("# symbols among the names");
const symbols = [Symbol("first"), Symbol.iterator, Symbol.for("shared"), Symbol.toPrimitive];
for (const size of [0, 5, 40, 140]) {
  const object = Object.create(null);
  const names = namesOf("symbols" + size, size);
  for (let k = 0; k < size; k++) {
    object[names[k]] = k;
    if (k % 11 === 3) object[symbols[(k / 11) % symbols.length | 0]] = -k;
  }
  object[symbols[0]] = "last";
  object[fresh("after")] = 1;
  console.log(size, digest(describe(object)), Object.getOwnPropertySymbols(object).length, listed(object));
}

console.log("# names deleted, and given again");
for (const size of [2, 6, 9, 20, 64, 129, 300]) {
  for (const step of [1, 2, 3, 7]) {
    const names = namesOf("deleted" + size + "_" + step, size);
    const object = fill(Object.create(null), names);
    for (let k = 0; k < size; k += step) delete object[names[k]];
    const afterDeleting = digest(describe(object));
    fill(object, namesOf("more" + size + "_" + step, 12), 1000);
    const afterMore = digest(describe(object));
    for (let k = 0; k < size; k += step) object[names[k]] = -k;
    console.log(size, step, afterDeleting, afterMore, digest(describe(object)), listed(object));
  }
}

console.log("# a queue of names: each turn the oldest goes and a new one comes");
{
  const queue = Object.create(null);
  let line = "";
  for (let turn = 0; turn < 2000; turn++) {
    queue[fresh("turn" + turn)] = turn;
    if (turn >= 20) delete queue[fresh("turn" + (turn - 20))];
    if (turn % 400 === 399) line += digest(describe(queue)) + " ";
  }
  console.log(line);
}

console.log("# getters, setters and attributes that come later");
for (const size of [1, 6, 8, 40, 140]) {
  const names = namesOf("later" + size, size);
  const object = fill({}, names);
  let stored = "nothing";
  Object.defineProperty(object, names[size >> 1], { get() { return "got"; }, set(value) { stored = value; }, enumerable: true, configurable: true });
  object[names[size >> 1]] = "through the setter";
  Object.defineProperty(object, names[0], { value: "fixed", writable: false, enumerable: size % 2 === 0, configurable: true });
  let threw = "no";
  try { fill(object, [names[0]]); } catch (error) { threw = error.constructor.name; }
  fill(object, namesOf("behind" + size, 5), 500);
  console.log(size, stored, threw, digest(describe(object)), listed(object));
}

console.log("# objects above that answer a store");
for (const size of [0, 4, 40, 140]) {
  let stored = [];
  const withSetter = Object.create(null, { caught: { set(value) { stored.push(value); }, configurable: true }, fixed: { value: 1, writable: false } });
  const object = fill(Object.create(withSetter), namesOf("below" + size, size));
  object[fresh("caught")] = size;
  let threw = "no";
  try { object[fresh("fixed")] = 2; } catch (error) { threw = error.constructor.name; }
  object[fresh("free")] = 3;
  console.log(size, stored.join(), threw, Object.hasOwn(object, "caught"), Object.hasOwn(object, "fixed"), digest(describe(object)));

  const seen = [];
  const behindProxy = fill(Object.create(new Proxy({}, { set(target, key, value, receiver) { seen.push(String(key)); return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }); } })), namesOf("proxy" + size, size));
  console.log(size, seen.length, digest(describe(behindProxy)));

  const late = fill(Object.create(withSetter), namesOf("late" + size, size));
  Object.defineProperty(withSetter, "afterwards", { set(value) { stored.push("afterwards " + value); }, configurable: true });
  late[fresh("afterwards")] = size;
  console.log(size, stored.join(), Object.hasOwn(late, "afterwards"));
  delete withSetter.afterwards;
}

console.log("# objects that take no more names");
for (const size of [1, 6, 8, 40, 140]) {
  for (const [how, close, isClosed] of [["preventExtensions", Object.preventExtensions, object => !Object.isExtensible(object)], ["seal", Object.seal, Object.isSealed], ["freeze", Object.freeze, Object.isFrozen]]) {
    const names = namesOf(how + size, size);
    const object = close(fill(Object.create(null), names));
    let threw = "no";
    try { object[fresh("more")] = 1; } catch (error) { threw = error.constructor.name; }
    let threwAtOld = "no";
    try { object[names[0]] = "again"; } catch (error) { threwAtOld = error.constructor.name; }
    console.log(size, how, threw, threwAtOld, isClosed(object), "more" in object, digest(describe(object)));
  }
}

console.log("# an object that others look up to is given names");
for (const size of [0, 5, 40, 140]) {
  const above = fill({}, namesOf("above" + size, size));
  const below = Object.create(above);
  const name = fresh("arrives" + size);
  let line = size + ":";
  for (let turn = 0; turn < 3; turn++) line += " " + below[name] + " " + (name in below);
  above[name] = "arrived";
  for (let turn = 0; turn < 3; turn++) line += " " + below[name] + " " + (name in below);
  delete above[name];
  line += " " + below[name] + " " + (name in below);
  console.log(line);
}

console.log("# copies, and what reads the names at once");
for (const size of [3, 8, 40, 140, 300]) {
  const object = fill(Object.create(null), namesOf("copied" + size, size));
  const spread = { ...object };
  const assigned = Object.assign({}, object);
  const { [fresh("ncopied" + size + "_0")]: first, ...rest } = object;
  const cloned = structuredClone(fill({}, namesOf("copied" + size, size)));
  console.log(size, digest(describe(spread)), digest(describe(assigned)), first, digest(describe(rest)), digest(describe(cloned)), digest(describe(Object.fromEntries(Object.entries(object)))));
  spread[fresh("more")] = 1;
  assigned[fresh("more")] = 1;
  rest[fresh("more")] = 1;
  console.log(size, digest(describe(spread)), digest(describe(assigned)), digest(describe(rest)));
}

console.log("# names that nothing but the object keeps, over collections");
{
  const kept = [];
  for (let round = 0; round < 40; round++) {
    const object = Object.create(null);
    for (let k = 0; k < 50; k++) object[fresh("round" + round + "name" + k)] = { round, k };
    if (round % 4 === 0) kept.push(object);
    if (round % 10 === 9) Bun.gc(true);
  }
  Bun.gc(true);
  let text = "";
  for (const object of kept) for (const name in object) text += name + object[name].round + object[name].k;
  console.log(digest(text));
}

console.log("# counts by words, each text in an order of its own");
{
  const words = [];
  for (let k = 0; k < 90; k++) words.push("word" + k);
  let line = "";
  for (let text = 0; text < 60; text++) {
    const counts = {};
    for (let k = 0; k < 300; k++) {
      const word = fresh(words[(k * (text + 7) + (k >> 3) * text) % words.length]);
      counts[word] = (counts[word] || 0) + 1;
    }
    if (text % 10 === 0) line += digest(describe(counts)) + " ";
  }
  console.log(line);
}
