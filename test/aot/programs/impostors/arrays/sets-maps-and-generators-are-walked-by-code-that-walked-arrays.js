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

function collect(list, change) {
  const seen = [];
  for (const value of list) {
    if (seen.length === 1) change(list);
    seen.push(value);
    if (seen.length === 8) break;
  }
  return seen;
}

function pairs(list, change) {
  const seen = [];
  let turn = 0;
  for (const [key, value] of list) {
    if (turn++ === 1) change(list);
    seen.push(key, value);
    if (turn === 8) break;
  }
  return seen;
}

function sum(list, change) {
  let total = 0;
  let turn = 0;
  for (const value of list) {
    if (turn++ === 1) change(list);
    total += value;
    if (turn === 8) break;
  }
  return total;
}

function nested(list, change) {
  const seen = [];
  for (const outer of list) {
    for (const inner of list) seen.push(String(outer) + String(inner));
    if (seen.length > 12) break;
  }
  return seen;
}

function copiedTwice(list, change) {
  return [[...list], [...list]];
}

const uses = { collect, pairs, sum, nested, copiedTwice };

function* count() {
  yield 1;
  yield 2;
  yield 3;
}

function* pairsOf() {
  yield [1, "a"];
  yield "bc";
  yield { 0: "not", 1: "iterable" };
}

const cases = {
  "an array": [() => [1, 2, 3], list => {}],
  "an array of pairs": [() => [[1, "a"], [2, "b"], [3, "c"]], list => {}],
  "a Set": [() => new Set([1, 2, 3]), list => {}],
  "a Set that gains a value": [() => new Set([1, 2, 3]), list => list.add(4)],
  "a Set that loses the next value": [() => new Set([1, 2, 3]), list => list.delete(3)],
  "a Set that loses a visited value and regains it": [() => new Set([1, 2, 3]), list => { list.delete(1); list.add(1); }],
  "a Set that is cleared": [() => new Set([1, 2, 3]), list => list.clear()],
  "a Set that is cleared and refilled": [() => new Set([1, 2, 3]), list => { list.clear(); list.add(7).add(8); }],
  "a Set of pairs": [() => new Set([[1, "a"], [2, "b"]]), list => {}],
  "a Map": [() => new Map([[1, "a"], [2, "b"], [3, "c"]]), list => {}],
  "a Map that gains an entry": [() => new Map([[1, "a"], [2, "b"]]), list => list.set(9, "z")],
  "a Map that loses the next entry": [() => new Map([[1, "a"], [2, "b"], [3, "c"]]), list => list.delete(3)],
  "a Map whose next value changes": [() => new Map([[1, "a"], [2, "b"], [3, "c"]]), list => list.set(3, "changed")],
  "the keys of a Map": [() => new Map([[1, "a"], [2, "b"]]).keys(), list => {}],
  "the entries of an array": [() => ["a", "b", "c"].entries(), list => {}],
  "the values of an array": [() => [1, 2, 3].values(), list => {}],
  "a generator": [() => count(), list => {}],
  "a generator that is advanced in the body": [() => count(), list => list.next()],
  "a generator that is closed in the body": [() => count(), list => list.return()],
  "a generator of pairs, a string and an object": [() => pairsOf(), list => {}],
  "a subclass of Set with its own iterator": [() => new (class extends Set { *[Symbol.iterator]() { yield "own"; } })([1, 2]), list => {}],
  "a Set with its own values method": [() => Object.assign(new Set([1, 2]), { values: () => [9].values() }), list => {}],
  "an iterator helper": [() => [1, 2, 3].values().map(value => value * 10), list => {}],
  "a WeakSet": [() => new WeakSet(), list => {}],
};

for (const use in uses) {
  for (let i = 0; i < 1000; i++) {
    uses[use](use === "pairs" ? [[1, "a"], [2, "b"]] : [1, 2, 3], () => {});
  }
}

for (const name in cases) {
  for (const use in uses) {
    const [make, change] = cases[name];
    attempt(name + ", " + use, () => uses[use](make(), change));
  }
}
