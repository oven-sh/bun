function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function sumOfInt32(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total = (total + list[i]) | 0;
  return total;
}

function product(list) {
  let result = 1;
  for (let i = 0; i < list.length; i++) result *= list[i];
  return result;
}

function largest(list) {
  let best = -Infinity;
  for (let i = 0; i < list.length; i++) if (list[i] > best) best = list[i];
  return best;
}

function doubled(list) {
  const result = [];
  for (let i = 0; i < list.length; i++) result.push(list[i] * 2);
  return result;
}

function truncated(list) {
  const result = [];
  for (let i = 0; i < list.length; i++) result.push(list[i] | 0);
  return result;
}

function sumWithForOf(list) {
  let total = 0;
  for (const value of list) total += value;
  return total;
}

function sumWithReduce(list) {
  return list.reduce((total, value) => total + value, 0);
}

function countOfZeros(list) {
  let count = 0;
  for (let i = 0; i < list.length; i++) if (list[i] === 0) count++;
  return count;
}

function incrementedInPlace(list) {
  for (let i = 0; i < list.length; i++) list[i]++;
  return list;
}

const uses = [sum, sumOfInt32, product, largest, doubled, truncated, sumWithForOf, sumWithReduce, countOfZeros, incrementedInPlace];
const lists = {
  "integers": () => [1, 2, 3],
  "one fraction": () => [1, 2.5, 3],
  "one text": () => [1, "2", 3],
  "texts": () => ["1", "2", "3"],
  "a hole": () => [1, , 3],
  "undefined": () => [1, undefined, 3],
  "null": () => [1, null, 3],
  "true": () => [1, true, 3],
  "NaN": () => [1, NaN, 3],
  "negative zero": () => [-0, -0],
  "only negative zero": () => [-0],
  "the largest int32": () => [2147483647, 1],
  "2 ** 31": () => [2147483648, 1],
  "a bigint": () => [1, 2n, 3],
  "bigints": () => [1n, 2n, 3n],
  "an object with valueOf": () => [1, { valueOf: () => 2 }, 3],
  "a nested array": () => [1, [2], 3],
  "a date": () => [1, new Date(2), 3],
  "a symbol": () => [1, Symbol("s"), 3],
  "a Number object": () => [1, new Number(2), 3],
  "empty": () => [],
  "holes only": () => Array(3),
  "Infinity and -Infinity": () => [Infinity, -Infinity],
};

for (let i = 0; i < 2000; i++) for (const use of uses) use([i, i + 1, i + 2]);
for (const use of uses) for (const name of Object.keys(lists)) attempt(use.name + " of " + name, () => use(lists[name]()));
for (const use of uses) attempt(use.name + " of integers again", () => use([1, 2, 3]));
