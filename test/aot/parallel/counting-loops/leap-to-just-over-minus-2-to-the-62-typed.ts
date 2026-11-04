// A loop that counts. Downwards, to two over -4611686018427387904.
// Every operand is declared a number.
const unknown = (value: any): any => new CustomEvent("unknown", { detail: value }).detail;
const show = (value: any): string =>
  Object.is(value, -0) ? "-0"
  : typeof value === "string" ? JSON.stringify(value)
  : typeof value === "bigint" ? value + "n"
  : typeof value === "symbol" ? "a symbol"
  : typeof value === "function" ? "a function"
  : Array.isArray(value) ? "[" + value.map(show).join(", ") + "]"
  : value !== null && typeof value === "object" ? "an object"
  : String(value);
function run(n: number): any {
  let s = 0, i = 0;
  for (; i > n; i--) {
    if (i === -2) i = -4611686018427387904 + 2;
    if (++s === 9) break;
  }
  return [s, i];
}
for (const given of unknown([
  [0],
  [-2],
  [-3],
  [-2.5],
  [-4611686018427387904 + 1],
  [-4611686018427387904],
  [-4611686018427387904 - 1],
  [-4611686018427387904 - 3],
  [-4611686018427387904 * 2],
  [-Infinity],
  [NaN],
  [-1e300],
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
