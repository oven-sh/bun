// A loop that counts. The step is handed in.
// Every operand is a number, of which the build knows nothing else.
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
function run(from, n, by) {
  let s = 0, i = from;
  for (; i < n; i += by) if (++s === 7) break;
  return [s, i];
}
for (const given of unknown([
  [0, 5, 1],
  [0, 5, 2],
  [0, 5, 0.5],
  [0, 5, 0],
  [0, 5, -0],
  [0, 5, -1],
  [0, 5, NaN],
  [0, 5, Infinity],
  [0, Infinity, Infinity],
  [0, 2 ** 32, 2 ** 31 - 1],
  [0, 2 ** 53, 2 ** 52],
  [2 ** 53 - 2, Infinity, 1],
  [2 ** 53 - 2, Infinity, 2],
  [2 ** 31 - 2, 2 ** 31 + 9, 3],
  [0, 1, 1e-300],
  [0.1, 1, 0.1],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1], +given[2]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
