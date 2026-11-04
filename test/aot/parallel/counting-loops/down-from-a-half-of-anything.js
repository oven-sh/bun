// A loop that counts. The counter starts at a written 0.5.
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
  let s = 0, i = 0.5;
  for (; i > n; i--) if (++s === 9) break;
  return [s, i];
}
for (const given of unknown([
  [0.5 - 0],
  [0.5 - 1],
  [0.5 - 2],
  [0.5 - 3],
  [0.5 - 4],
  [0.5 - 6],
  [0.5 - 0.5],
  [0.5 - 2.5],
  [0.5 + 1],
  [NaN],
  [Infinity],
  [-Infinity],
  [0],
  [-0],
  ["5"],
  [null],
  [3n],
])) {
  let answer;
  try {
    answer = show(run(given[0]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
