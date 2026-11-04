// A loop that counts. What the counter holds behind the loop.
// The values arrive as they are, of every kind.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const show = value =>
  Object.is(value, -0) ? "-0"
  : typeof value === "string" ? JSON.stringify(value)
  : typeof value === "bigint" ? value + "n"
  : typeof value === "symbol" ? "a symbol"
  : typeof value === "function" ? "a function"
  : Array.isArray(value) ? "[" + value.map(show).join(", ") + "]"
  : value !== null && typeof value === "object" ? "an object"
  : String(value);
function run(from, n) {
  let s = 0, i = from;
  for (; i < n; i++) s++;
  return [s, i];
}
for (const given of unknown([
  [0, 0],
  [0, 1],
  [0, 5],
  [0, -1],
  [0, -0],
  [-0, 0],
  [-0, 2],
  [0, 0.5],
  [0, 2.5],
  [0, 3.000000001],
  [0, NaN],
  [NaN, 3],
  [0, -Infinity],
  [-Infinity, -Infinity],
  [-3, 2],
  [0.5, 3],
  [-0.5, 2],
  [5, 0],
  [2 ** 31 - 3, 2 ** 31 - 1],
  [2 ** 31 - 3, 2 ** 31],
  [2 ** 31 - 3, 2 ** 31 + 3],
  [2 ** 31 - 1.5, 2 ** 31 + 1.5],
  [2 ** 32 - 2, 2 ** 32 + 2],
  [-(2 ** 31) - 3, -(2 ** 31) + 3],
  [-(2 ** 32) - 2, -(2 ** 32) + 2],
  [2 ** 53 - 3, 2 ** 53 - 1],
  [2 ** 53 - 3, 2 ** 53],
  [-(2 ** 53), -(2 ** 53) + 3],
  [1e15, 1e15 + 3],
  [0, "5"],
  [0, "2.5"],
  [0, "abc"],
  [0, ""],
  [0, " 3 "],
  [0, "0x3"],
  [0, null],
  [0, undefined],
  [0, true],
  [0, false],
  [0, [3]],
  [0, []],
  [0, [1, 2]],
  [0, {}],
  [0, { valueOf: () => 3 }],
  [0, { toString: () => "2" }],
  [0, 3n],
  [0, Symbol()],
  ["0", 3],
  ["1", "3"],
  ["a", "c"],
  ["", 2],
  [null, 2],
  [undefined, 2],
  [true, 3],
  [[1], 3],
  [{ valueOf: () => 1 }, 3],
  [0n, 3],
  [0n, 3n],
  [1n, 2.5],
  [Symbol(), 3],
])) {
  let answer;
  try {
    answer = show(run(given[0], given[1]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
