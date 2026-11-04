// A loop that counts. The counter starts at a written 0 and is put two below 4611686018427387904 by a written number: it stays an integer to the build, and crosses the border in the loop.
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
function run(n) {
  let s = 0, i = 0;
  for (; i < n; i++) {
    if (i === 2) i = 4611686018427387904 - 2;
    if (++s === 9) break;
  }
  return [s, i];
}
for (const given of unknown([
  [0],
  [2],
  [3],
  [2.5],
  [4611686018427387904 - 1],
  [4611686018427387904],
  [4611686018427387904 + 1],
  [4611686018427387904 + 3],
  [4611686018427387904 * 2],
  [Infinity],
  [NaN],
  [1e300],
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
