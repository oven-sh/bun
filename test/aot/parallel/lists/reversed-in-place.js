// nearley reverses lists of two to four results. Lists of every length and kind, with holes, frozen, shared, of subclasses, with accessors, not lists at all.
const kinds = [k => k, k => "s" + k, k => ({ k }), k => k + 0.5, k => (k % 2 ? k : "m" + k), k => [k], k => (k % 3 ? undefined : null), k => -0 * k, k => BigInt(k), k => NaN, k => () => k];
const show = value => (Array.isArray(value) ? "[" + Array.from(value, (element, k) => (k in value ? show(element) : "hole")).join() + "]" : typeof value === "object" && value ? JSON.stringify(value) : typeof value === "function" ? "f" + value() : Object.is(value, -0) ? "-0" : String(value));
function build(length, kind) {
  const list = [];
  for (let k = 0; k < length; k++) list.push(kind(k));
  return list;
}
let lines = 0;
for (const kind of kinds) {
  for (const length of [0, 1, 2, 3, 4, 5, 8, 15, 16, 17, 18, 33, 70]) {
    const list = build(length, kind);
    const reversed = list.reverse();
    if (reversed !== list || reversed.length !== length) throw new Error("another list");
    if (length < 18) console.log(show(list), show(list.reverse()));
    lines++;
  }
}
const unknown = JSON.parse('[[3, 2, 1], ["a", {"b": 1}], [1.5, 2], []]');
for (const list of unknown) console.log(show(list.reverse()), show([...list].reverse()), show(Array.prototype.reverse.call(list)));

const holes = [1, , 3];
console.log(show(holes.reverse()), show([, 2, "x"].reverse()), show(["a", "b", ,].reverse()), show(new Array(3).reverse()));
const shortened = build(9, kinds[2]);
shortened.length = 4;
console.log(show(shortened.reverse()));
const lengthened = ["a", "b"];
lengthened.length = 4;
console.log(show(lengthened.reverse()));
const literal = () => [1, 2, 3];
literal().reverse();
console.log(show(literal()), show(literal().reverse()), show(["x", "y"].reverse()));
for (const closed of [Object.freeze, Object.seal, Object.preventExtensions]) {
  const list = closed(["p", "q", "r"]);
  try {
    console.log(show(list.reverse()));
  } catch (error) {
    console.log(error.name, show(list));
  }
}
class Below extends Array {}
const below = Below.from([1, "two", 3]);
console.log(below.reverse() === below, show(below), below instanceof Below);
const accessors = ["a", "b", "c"];
let log = "";
Object.defineProperty(accessors, 0, { get: () => (log += "g", "got"), set: value => (log += "s" + value), configurable: true });
console.log(accessors.reverse() === accessors, log, accessors.length, accessors[1], accessors[2]);
const readOnly = Object.defineProperty([1, 2, 3], 2, { writable: false });
try {
  console.log(show(readOnly.reverse()));
} catch (error) {
  console.log(error.name, show(readOnly));
}
const named = Object.assign(["n", "m"], { name: "named" });
console.log(show(named.reverse()), named.name);
console.log(show(Array.prototype.reverse.call({ length: 3, 0: "a", 2: "c" })), Array.prototype.reverse.call("x") instanceof String);
const traps = [];
const proxy = new Proxy([1, 2], { get: (target, key) => (traps.push("get " + String(key)), target[key]), set: (target, key, value) => (traps.push("set " + String(key)), (target[key] = value), true) });
Array.prototype.reverse.call(proxy);
console.log(traps.join());
for (const value of [null, undefined]) {
  try {
    Array.prototype.reverse.call(value);
  } catch (error) {
    console.log(error.name);
  }
}

// Lists kept while others are collected.
const kept = [];
let sum = 0;
for (let k = 0; k < 20000; k++) {
  const list = [{ k }, "t" + k, [k], k];
  list.reverse();
  if (k % 50 === 0) kept.push(list);
  if (k % 400 === 0) for (const other of kept) other.reverse();
  sum += list[0] === k ? 1 : 0;
}
console.log(lines, sum, kept.length, show(kept[7]), show(kept[399]));
