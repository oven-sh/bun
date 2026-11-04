// A loop that counts. `n = Infinity`, `n = 2 ** 53`.
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
  for (; i < n; i++) {
    if (i === 1) n = i & 2 ? Infinity : 2 ** 53;
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
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
