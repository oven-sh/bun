// A loop that counts. The bound lies out of reach, and the loop leaves by a break.
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
  let last = from, turns = 0;
  for (let i = from; i < n; i++) {
    last = i;
    if (++turns === 6) break;
  }
  return [last, turns];
}
for (const given of unknown([
  [0, Infinity],
  [0, 1e300],
  [0, 2 ** 31 + 5],
  [2 ** 31 - 3, Infinity],
  [2 ** 53 - 3, 2 ** 53 + 2],
  [2 ** 53 - 3, Infinity],
  [2 ** 53 - 3, 1e300],
  [2 ** 53, Infinity],
  [2 ** 53 - 1, 2 ** 53 + 4],
  [1e300, Infinity],
  [0.5, Infinity],
  [0, 0],
  [0, 1],
  [0, 5],
  [0, -1],
  [0, -0],
  [-0, 0],
  [-0, 2],
  [0, 0.5],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
