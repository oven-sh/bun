// A loop that counts. `%` and `/` of the counter: -0, NaN and fractions come out of integers.
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
function run(from: number, n: number, by: number): any {
  const seen = [];
  for (let i = from; i < n; i++) seen.push(i % by, i / by, -i, i * by);
  return seen;
}
for (const given of unknown([
  [-2, 3, 2],
  [-2, 3, -2],
  [-1, 2, 0],
  [-1, 2, -0],
  [0, 2, NaN],
  [0, 2, Infinity],
  [2 ** 31 - 1, 2 ** 31 + 1, -1],
  [-(2 ** 31) - 1, -(2 ** 31) + 1, -1],
  [-1, 2, 0.5],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1], +given[2]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
