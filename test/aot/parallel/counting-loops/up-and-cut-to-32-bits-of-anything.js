// A loop that counts. `i = (i + 1) | 0` comes round at 2 ** 31.
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
  for (; i < n; i = (i + 1) | 0) if (++s === 7) break;
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
  [0, Infinity],
  [0, 1e300],
  [0, 2 ** 31 + 5],
  [2 ** 31 - 3, Infinity],
  [2 ** 53 - 3, 2 ** 53 + 2],
  [2 ** 53 - 3, Infinity],
  [2 ** 53 - 3, 1e300],
  [2 ** 53, Infinity],
  [2 ** 53 - 1, 2 ** 53 + 4],
  [1e300, Infinity],
  [0.5, Infinity],
  [0, "5"],
  [0, "2.5"],
  [0, "abc"],
  [0, ""],
  [0, " 3 "],
  [0, "0x3"],
])) {
  let answer;
  try {
    answer = show(run(given[0], given[1]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
