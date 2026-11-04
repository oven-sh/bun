// A loop that counts. The counter starts at a written 9007199254740989.
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
  let s = 0, i = 9007199254740989;
  for (; i > n; i--) if (++s === 9) break;
  return [s, i];
}
for (const given of unknown([
  [9007199254740989 - 0],
  [9007199254740989 - 1],
  [9007199254740989 - 2],
  [9007199254740989 - 3],
  [9007199254740989 - 4],
  [9007199254740989 - 6],
  [9007199254740989 - 0.5],
  [9007199254740989 - 2.5],
  [9007199254740989 + 1],
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
