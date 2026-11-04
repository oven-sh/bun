// A loop that counts. The loop is left in the middle of eight turns.
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
function run(n: number, at: number): any {
  let s = 0, i = 0;
  for (; i < n; i++) {
    if (i === at) break;
    s += 2;
  }
  return [s, i];
}
for (const given of unknown([
  [20, 0],
  [20, 3],
  [20, 7],
  [20, 8],
  [20, 9],
  [20, 15],
  [20, 16],
  [20, 19],
  [20, 20],
  [20, 1048575],
  [20, 1048576],
  [20, 1048577],
  [20, -1],
  [20, 2.5],
  [20, NaN],
  [1048600, 0],
  [1048600, 3],
  [1048600, 7],
  [1048600, 8],
  [1048600, 9],
  [1048600, 15],
  [1048600, 16],
  [1048600, 19],
  [1048600, 20],
  [1048600, 1048575],
  [1048600, 1048576],
  [1048600, 1048577],
  [1048600, -1],
  [1048600, 2.5],
  [1048600, NaN],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
