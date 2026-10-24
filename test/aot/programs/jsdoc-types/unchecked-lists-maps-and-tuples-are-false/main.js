function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

/** @param {number[]} list */
function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

/** @param {number[]} list */
function doubled(list) {
  return list.map(n => n * 2);
}

/** @type {number[]} */
const honest = [1, 2, 3];

/** @type {number[]} */
const texts = ["1", "2"];

/** @type {number[]} */
const mixed = [1, "2", null, undefined, true, [3], { valueOf: () => 4 }];

/** @type {number[]} */
const holes = [1, , 3];

/** @type {number[]} */
const empty = new Array(3);

/** @type {number[]} */
const like = { length: 2, 0: 1, 1: 2 };

/** @type {number[]} */
const typed = new Float64Array([1.5, 2.5]);

/** @type {number[]} */
const set = new Set([1, 2]);

/** @type {number[]} */
const word = "12";

/** @type {Float64Array} */
const plain = [1.5, "2.5"];

/** @type {[number, string]} */
const swapped = ["one", 1];

/** @type {[number, string]} */
const short = [1];

/** @type {[number, string]} */
const long = [1, "one", true, null];

/** @type {Map<string, number>} */
const map = new Map([
  ["a", "1"],
  [2, 2],
]);

/** @type {Map<string, number>} */
const record = { a: 1, get: () => "own get", size: "big" };

/** @type {Set<number>} */
const words = new Set(["a", 1]);

/** @type {Record<string, number>} */
const table = { a: "1", b: null, c: [3] };

/** @type {Record<string, number>} */
const listed = [1, 2];

/** @type {readonly number[]} */
const fixed = [1, 2];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total(honest) + doubled(honest)[2] + total([i]);
console.log("2000 honest rounds: " + warm);

for (const [name, list] of Object.entries({ honest, texts, mixed, holes, empty, like, typed, set, word })) {
  attempt(name + ", summed by index", () => [total(list), typeof total(list)]);
  attempt(name + ", summed by iteration", () => {
    let sum = 0;
    for (const n of list) sum += n;
    return sum;
  });
  attempt(name + ", mapped", () => doubled(list));
  attempt(name + ", read", () => [list.length, list[0], list[1] + 1, 1 in list, Array.isArray(list)]);
  attempt(name + ", pushed to", () => [list.push(9), list.length]);
}

attempt("a typed array that is a list", () => [plain[0] + plain[1], plain.length, plain.byteLength, plain.map(n => n + 1)]);
attempt("tuples", () => [swapped[0] + 1, swapped[1] + "!", short[1], short[1] + "!", long.length, long[2]]);
attempt("a tuple, the length of a text that is a number", () => swapped[1].length);
attempt("a tuple, the length of a text that is not there", () => short[1].length);
attempt("a tuple, taken apart", () => {
  const [n, s] = swapped;
  const [m, t = "default"] = short;
  return [n + 1, s + 1, m + 1, t];
});
attempt("a map", () => [map.get("a") + 1, map.get(2) + 1, map.get("2"), map.size, [...map.values()].map(n => n + 1)]);
attempt("a map that is a literal", () => [record.get("a"), record.size, record.a]);
attempt("a map that is a literal, a method it lacks", () => record.has("a"));
attempt("a set", () => [words.has("a"), words.has(1), [...words].map(n => n + 1)]);
attempt("a record", () => [table.a + 1, table.b + 1, table.c + 1, table.d + 1, Object.values(table).map(n => n + 1)]);
attempt("a record that is a list", () => [listed[0] + 1, listed.length, Object.keys(listed).join()]);
attempt("a list declared read-only is changed", () => {
  fixed.push(3);
  fixed[0] = "first";
  fixed.length = 2;
  return [fixed, total(fixed)];
});
