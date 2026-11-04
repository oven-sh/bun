// A loop that counts. The same loop on BigInts, which no width ends.
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
  let s = 0n, i = from;
  for (; i < n; i++) s += i;
  return [s, i];
}
for (const given of unknown([
  [0n, 5n],
  [0n, 5],
  [0n, 2.5],
  [0n, NaN],
  [2n ** 31n - 2n, 2n ** 31n + 2n],
  [2n ** 53n - 2n, 2n ** 53n + 2n],
  [2n ** 63n - 2n, 2n ** 63n + 2n],
  [2n ** 64n - 2n, 2n ** 64n + 2n],
  [-2n, 2n],
  [0n, "3"],
])) {
  let answer;
  try {
    answer = show(run(given[0], given[1]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
