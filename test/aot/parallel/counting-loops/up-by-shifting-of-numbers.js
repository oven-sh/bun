// A loop that counts. `i <<= 1` comes round to a negative number, then to zero.
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
function run(from, n) {
  let s = 0, i = from;
  for (; i < n; i <<= 1) if (++s === 40) break;
  return [s, i];
}
for (const given of unknown([
  [1, 100],
  [1, 2 ** 31],
  [1, 2 ** 31 - 1],
  [3, 2 ** 32],
  [0, 5],
  [1.5, 9],
  [2 ** 32 + 1, 2 ** 32 + 9],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
