// A loop that counts. Which tally grows goes by a test in the turn.
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
  let even = start, odd = start;
  for (let i = 0; i < n; i++) {
    if (i & 1) odd++;
    else even += 2;
  }
  return [even, odd];
}
for (const given of unknown([
  [0, 0],
  [7, 0],
  [7, 2 ** 31 - 4],
  [7, 2 ** 53 - 4],
  [7, 0.5],
  [7, -0],
  [1, -0],
  [2, NaN],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
