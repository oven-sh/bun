// A loop that counts. The bound of the inner loop is the counter of the outer one.
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
  let s = 0;
  for (let i = from; i < n; i++) for (let j = from; j < i; j++) s++;
  return s;
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
])) {
  let answer;
  try {
    answer = show(run(given[0], given[1]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
