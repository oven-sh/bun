// A loop that counts. `i *= 2` leaves every width.
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
  for (; i < n; i *= 2) if (++s === 1100) break;
  return [s, i];
}
for (const given of unknown([
  [1, 100],
  [1, 2 ** 31 + 1],
  [1, 2 ** 32 * 4],
  [1, 2 ** 53 * 4],
  [1, Infinity],
  [0, 5],
  [-1, 5],
  [3, 1e300],
  [0.5, 9],
  [NaN, 5],
  ["1", 9],
  [1n, 9],
  [1n, 9n],
])) {
  let answer;
  try {
    answer = show(run(given[0], given[1]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
