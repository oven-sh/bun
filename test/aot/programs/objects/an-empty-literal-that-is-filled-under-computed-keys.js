// `{}` that gets its properties under keys nobody knows at build time, as lodash's mapValues fills its result. Such an object has no name that a slot could be kept for.
// Beside it: literals that look the same and get names, literals with another prototype, and places where the two kinds meet.
const lines = [];
function show(value) {
  return JSON.stringify(value) + " " + Object.keys(value).join() + " " + Object.getOwnPropertyNames(value).length;
}

function mapValues(object, iteratee) {
  var result = {};
  for (var key in object) result[key] = iteratee(object[key], key);
  return result;
}
function invert(object) {
  const result = {};
  for (const key of Object.keys(object)) result[object[key]] = key;
  return result;
}
function countBy(list, keyOf) {
  const counts = {};
  for (const item of list) {
    const key = keyOf(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
function named(i) {
  var o = {};
  o.a = i;
  o.b = i + 1;
  return o;
}
function filledByHelper(i) {
  const o = {};
  fill(o, i);
  return o;
}
function fill(target, i) {
  target.first = i;
  target.second = "s" + i;
}
function either(flag, key) {
  const o = flag ? {} : { fixed: 1 };
  o[key] = flag;
  return o;
}
function copyOf(source) {
  return { ...source };
}
function withComputedKey(key, value) {
  return { [key]: value };
}
function withoutPrototype(key) {
  const o = { __proto__: null };
  o[key] = 1;
  return o;
}
function belowAnother(above, key) {
  const o = { __proto__: above };
  o[key] = 2;
  return o;
}

function put(target, key, value) {
  target[key] = value;
  return target;
}
function handedOnWithoutPrototype(key, value) {
  return put({ __proto__: null }, key, value);
}
function handedOnBelowAnother(above, key, value) {
  return put({ __proto__: above }, key, value);
}

const source = { b: 1, a: 2, 10: 3, 2: 4, c: 5 };
for (let round = 0; round < 3; round++) {
  const mapped = mapValues(source, (value, key) => value * (round + 1) + key.length);
  lines.push(show(mapped), show(invert(source)), show(countBy(["x", "yy", "z", "ww", "x" + round], item => item.length)));
  lines.push(show(named(round)), show(filledByHelper(round)), show(either(true, "k" + round)), show(either(false, "k" + round)), show(either(false, "fixed")));
  lines.push(show(copyOf(mapped)), show(copyOf(named(round))), show(copyOf([round, "e"])), show(withComputedKey("w" + round, round)), show(withComputedKey(round, "index")));
  lines.push(Object.keys(withoutPrototype("n" + round)).join(), "toString" in withoutPrototype("t"), Object.getPrototypeOf(withoutPrototype("p")));
  lines.push(belowAnother(mapped, "own").b, Object.keys(belowAnother(mapped, "own")).join(), Object.getPrototypeOf(belowAnother(mapped, "x")) === mapped);

  const bare = handedOnWithoutPrototype("h" + round, round);
  const heir = handedOnBelowAnother(bare, "i" + round, round + 1);
  lines.push(Object.getPrototypeOf(bare), "hasOwnProperty" in bare, Object.keys(bare).join(), bare["h" + round], Object.getPrototypeOf(heir) === bare, heir["h" + round], Object.keys(heir).join(), JSON.stringify(heir));
  lines.push(Object.getPrototypeOf(mapped) === Object.prototype, mapped.constructor === Object, mapped instanceof Object, String(mapped), typeof mapped, Object.prototype.toString.call(mapped));
  lines.push("a" in mapped, "missing" in mapped, "toString" in mapped, mapped.hasOwnProperty("b"), Object.hasOwn(mapped, "toString"), mapped.missing, mapped["2"], mapped[10]);
  delete mapped.a;
  mapped.late = "late";
  mapped[1] = "one";
  lines.push(show(mapped), Object.entries(mapped).join("|"), Object.values(mapped).join());
  Object.defineProperty(mapped, "hidden", { value: 7, enumerable: false, configurable: true });
  Object.defineProperty(mapped, "computed", { get() { return this.hidden + round; }, enumerable: true, configurable: true });
  lines.push(show(mapped), mapped.hidden, mapped.computed, JSON.stringify(Object.getOwnPropertyDescriptor(mapped, "hidden")), Reflect.ownKeys(mapped).join());
  const tag = Symbol("tag");
  mapped[tag] = round;
  lines.push(mapped[tag], Object.getOwnPropertySymbols(mapped).length, Reflect.ownKeys(mapped).length);
  lines.push(show(Object.assign({}, mapped, { more: 1 })), show(Object.assign(mapValues({}, x => x), source)), show(Object.fromEntries(Object.entries(mapped))));
  Object.freeze(mapped);
  for (const key of ["after", "b", 1, 77]) {
    try {
      mapped[key] = "changed";
    } catch (error) {
      lines.push(error.constructor.name);
    }
  }
  lines.push(Object.isFrozen(mapped), show(mapped), Object.isFrozen(mapValues(source, x => x)), Object.isFrozen(mapValues({}, x => x)), Object.isExtensible(mapValues({}, x => x)));
  let seen = "";
  for (const key in mapValues(source, x => x)) seen += key;
  for (const key in belowAnother(mapValues({ up: 1 }, x => x), "down")) seen += "," + key;
  lines.push(seen);
}

const many = {};
for (let i = 0; i < 300; i++) many["key" + (i % 150)] = i;
for (let i = 0; i < 100; i++) delete many["key" + i];
lines.push(Object.keys(many).length, many.key149, many.key0, JSON.stringify(many).length);

const cache = {};
function remember(key, make) {
  return key in cache ? cache[key] : (cache[key] = make());
}
lines.push(remember("one", () => 1), remember("one", () => 2), remember("__proto__", () => 3) === Object.prototype, remember("constructor", () => 4) === Object, Object.keys(cache).join());
console.log(lines.join("\n"));
console.log(mapValues(source, x => x), invert({ p: "q" }), {}, mapValues({}, x => x));
