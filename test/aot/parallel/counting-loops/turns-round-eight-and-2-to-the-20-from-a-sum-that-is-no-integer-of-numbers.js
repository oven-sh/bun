// A loop that counts. Numbers are not added in another order: the sum starts at a fraction, or where an integer more is lost.
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
function run(n, start) {
  let s = start;
  for (let i = 0; i < n; i++) s += i;
  return s;
}
for (const given of unknown([
  [7, 0.1],
  [7, -0],
  [7, 2 ** 53 - 3],
  [7, 2 ** 53],
  [7, 1e16],
  [7, -0.5],
  [7, 1e-9],
  [7, NaN],
  [7, Infinity],
  [8, 0.1],
  [8, -0],
  [8, 2 ** 53 - 3],
  [8, 2 ** 53],
  [8, 1e16],
  [8, -0.5],
  [8, 1e-9],
  [8, NaN],
  [8, Infinity],
  [9, 0.1],
  [9, -0],
  [9, 2 ** 53 - 3],
  [9, 2 ** 53],
  [9, 1e16],
  [9, -0.5],
  [9, 1e-9],
  [9, NaN],
  [9, Infinity],
  [17, 0.1],
  [17, -0],
  [17, 2 ** 53 - 3],
  [17, 2 ** 53],
  [17, 1e16],
  [17, -0.5],
  [17, 1e-9],
  [17, NaN],
  [17, Infinity],
  [1048577, 0.1],
  [1048577, -0],
  [1048577, 2 ** 53 - 3],
  [1048577, 2 ** 53],
  [1048577, 1e16],
  [1048577, -0.5],
  [1048577, 1e-9],
  [1048577, NaN],
  [1048577, Infinity],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
