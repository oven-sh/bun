// A loop that counts. From then on the test runs code of the program.
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
function run(n) {
  let s = 0, i = 0;
  for (; i < n; i++) {
    if (i === 1) n = { valueOf: () => (s < 5 ? 100 : 0) };
    if (++s === 12) break;
  }
  return [s, i, n];
}
for (const given of unknown([
  [0],
  [1],
  [3],
  [5],
  [8],
  [2.5],
  [NaN],
  [-1],
  [2 ** 31],
  [Infinity],
  ["6"],
  [null],
  [[6]],
  [6n],
])) {
  let answer;
  try {
    answer = show(run(given[0]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
