// A loop that counts. `while (--i > n)`.
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
function run(from: number, n: number): any {
  let turns = 0, i = from;
  while (--i > n) if (++turns === 7) break;
  return [turns, i];
}
for (const given of unknown([
  [0, 0],
  [1, 0],
  [5, 0],
  [-1, 0],
  [2, -0],
  [0, -0],
  [2.5, 0],
  [3, 0.5],
  [NaN, 0],
  [3, NaN],
  [3, Infinity],
  [2, -3],
  [2 ** 31 + 3, 2 ** 31 - 3],
  [-(2 ** 31) + 3, -(2 ** 31) - 3],
  [-(2 ** 32) + 2, -(2 ** 32) - 2],
  [2 ** 32 + 2, 2 ** 32 - 2],
  [-(2 ** 53) + 3, -(2 ** 53)],
  [-(2 ** 53) + 3, -(2 ** 53) + 1],
  [2 ** 53, 2 ** 53 - 3],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
