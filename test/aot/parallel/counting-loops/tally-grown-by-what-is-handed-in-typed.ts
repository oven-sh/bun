// A loop that counts. `s += by`.
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
function run(n: number, start: number, by: number): any {
  let s = start;
  for (let i = 0; i < n; i++) s += by;
  return s;
}
for (const given of unknown([
  [0, 0, 1],
  [5, 0, 1],
  [5, 2 ** 31 - 3, 1],
  [5, -(2 ** 31) + 3, -1],
  [5, 2 ** 32 - 3, 1],
  [5, 2 ** 53 - 3, 1],
  [5, -(2 ** 53) + 3, -1],
  [5, 2 ** 53 - 3, 2],
  [5, 0, 0.1],
  [10, 0, 0.1],
  [5, 0, 2 ** 30],
  [5, 0, 2 ** 52],
  [3, 1, 2 ** 53],
  [3, 0, NaN],
  [3, 0, Infinity],
  [2, Infinity, -Infinity],
  [3, -0, -0],
  [0, -0, 1],
  [3, 0, -0],
  [3, -0, 0],
  [1, -1, 1],
  [3, 1e308, 1e308],
  [3, 0.5, 1],
  [3, NaN, 1],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1], +given[2]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
