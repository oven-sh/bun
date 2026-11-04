// A loop that counts. `s--`.
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
  let s = start;
  for (let i = 0; i < n; i++) s--;
  return s;
}
for (const given of unknown([
  [0, 0],
  [5, 0],
  [0, -0],
  [1, 1],
  [5, -(2 ** 31) + 3],
  [5, -(2 ** 53) + 3],
  [5, 2 ** 31 + 3],
  [3, 0.5],
  [3, NaN],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
