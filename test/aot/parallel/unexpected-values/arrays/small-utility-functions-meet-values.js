// Small utility functions meet values that are not plain arrays.
function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function flatten(value) {
  return Array.isArray(value) ? value.reduce((all, item) => all.concat(flatten(item)), []) : [value];
}

function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

function unique(list) {
  const seen = [];
  for (let i = 0; i < list.length; i++) if (seen.indexOf(list[i]) === -1) seen.push(list[i]);
  return seen;
}

function compact(list) {
  const kept = [];
  for (const value of list) if (value) kept.push(value);
  return kept;
}

function last(list) {
  return list && list.length ? list[list.length - 1] : undefined;
}

function head(list, count) {
  const taken = [];
  for (let i = 0; i < count && i < list.length; i++) taken[i] = list[i];
  return taken;
}

function reversed(list) {
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i++) out[list.length - 1 - i] = list[i];
  return out;
}

function sum(list) {
  let total = 0;
  for (let i = 0, length = list.length; i < length; i++) total += list[i];
  return total;
}

function largest(list) {
  return list.length ? Math.max.apply(null, list) : undefined;
}

function toArray(list) {
  return Array.prototype.slice.call(list);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") {
    const copy = {};
    for (const key in value) copy[key] = clone(value[key]);
    return copy;
  }
  return value;
}

function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
    return true;
  }
  return false;
}

function isEmpty(list) {
  return !list || list.length === 0;
}

function partition(list, test) {
  const yes = [];
  const no = [];
  list.forEach(value => (test(value) ? yes : no).push(value));
  return [yes, no];
}

function countBy(list) {
  const counts = {};
  for (const value of list) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function insertSorted(list, value) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (list[middle] < value) low = middle + 1;
    else high = middle;
  }
  list.splice(low, 0, value);
  return list;
}

function shuffleBackwards(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = (i * 7) % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const uses = {
  flatten,
  chunk: list => chunk(list, 2),
  unique,
  compact,
  last,
  head: list => head(list, 2),
  reversed,
  sum,
  largest,
  toArray,
  clone,
  equalToItself: list => equal(list, list),
  equalToACopy: list => equal(list, clone(list)),
  isEmpty,
  partition: list => partition(list, value => value > 1),
  countBy,
  insertSorted: list => insertSorted(list, 2),
  shuffleBackwards,
};

class Loud extends Array {
  slice() {
    return "the subclass's slice";
  }
  map() {
    return "the subclass's map";
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const makers = {
  "an array": () => [1, 3, 3, 0],
  "nested arrays": () => [1, [3, [3]], 0],
  "a subclass": () => Loud.of(1, 3, 3, 0),
  "an array-like": () => ({ 0: 1, 1: 3, 2: 3, 3: 0, length: 4 }),
  "arguments": () => (function () { return arguments; })(1, 3, 3, 0),
  "a string": () => "1330",
  "a typed array": () => new Uint8Array([1, 3, 3, 0]),
  "a Set": () => new Set([1, 3, 0]),
  "a proxy": () => new Proxy([1, 3, 3, 0], {}),
  "a frozen array": () => Object.freeze([1, 3, 3, 0]),
  "an array with a hole": () => [1, , 3, 0],
  "doubles": () => [1.5, 3.5, 3.5, 0],
  "an array holding a proxy of an array": () => [1, new Proxy([3, 3], {}), 0],
  "an empty array": () => [],
  "null": () => null,
  "undefined": () => undefined,
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([1, 3, 3, 0]);

for (const name in makers) for (const use in uses) attempt(name + ", " + use, () => uses[use](makers[name]()));
