// A loop that counts. `s *= 2` goes to Infinity, `s /= 2` to zero.
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
function run(n: number, start: number): any {
  let s = start, t = start;
  for (let i = 0; i < n; i++) {
    s *= 2;
    t /= 2;
  }
  return [s, t];
}
for (const given of unknown([
  [0, 1],
  [30, 1],
  [31, 1],
  [32, 1],
  [53, 1],
  [54, 3],
  [1100, 1],
  [1100, -1],
  [3, 0],
  [3, -0],
  [3, NaN],
  [1080, 3],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
